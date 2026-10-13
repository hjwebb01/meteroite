import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { getOwnedReview } from "./lib/owned_review";
import {
  canResetPublication,
  publicationSnapshot,
} from "./lib/review_publication";
import { githubReview } from "./lib/review_fields";

export const claim = internalMutation({
  args: {
    id: v.id("reviews"),
    ownerId: v.string(),
    attemptId: v.string(),
    source: v.string(),
  },
  handler: async (ctx, { id, ownerId, attemptId, source }) => {
    const review = await getOwnedReview(ctx, id, ownerId);
    if (review.githubReview)
      return { state: "published" as const, githubReview: review.githubReview };
    if (
      review.githubPublication &&
      (review.githubPublication.remoteStartedAt ||
        Date.now() - review.githubPublication.startedAt < 60_000)
    )
      return { state: "busy" as const };
    if (review.status !== "completed" || !review.result || !review.headSha)
      return { state: "changed" as const };
    if ((await publicationSnapshot(ctx, review)).source !== source)
      return { state: "changed" as const };
    await ctx.db.patch("reviews", id, {
      githubPublication: {
        attemptId,
        source,
        state: "publishing",
        startedAt: Date.now(),
      },
    });
    return { state: "claimed" as const };
  },
});

// This transaction is the authorization point for each exact immutable payload.
// A conclusion arriving between preview/claim and the remote write invalidates it.
export const authorizeWrite = internalMutation({
  args: { id: v.id("reviews"), ownerId: v.string(), attemptId: v.string() },
  handler: async (ctx, { id, ownerId, attemptId }) => {
    const review = await getOwnedReview(ctx, id, ownerId);
    const attempt = review.githubPublication;
    if (!attempt || attempt.attemptId !== attemptId || review.githubReview)
      return false;
    if ((await publicationSnapshot(ctx, review)).source !== attempt.source)
      return false;
    await ctx.db.patch("reviews", id, {
      githubPublication: { ...attempt, remoteStartedAt: Date.now() },
    });
    return true;
  },
});

export const fail = internalMutation({
  args: {
    id: v.id("reviews"),
    ownerId: v.string(),
    attemptId: v.string(),
    uncertain: v.boolean(),
  },
  handler: async (ctx, { id, ownerId, attemptId, uncertain }) => {
    const review = await getOwnedReview(ctx, id, ownerId);
    if (review.githubPublication?.attemptId !== attemptId) return;
    await ctx.db.patch("reviews", id, {
      githubPublication: uncertain
        ? { ...review.githubPublication, state: "uncertain" }
        : undefined,
    });
  },
});

// The server must first complete a fresh GitHub lookup with no matching post.
// Reset is explicitly requested; it never retries the remote write itself.
export const reset = internalMutation({
  args: { id: v.id("reviews"), ownerId: v.string(), attemptId: v.string() },
  handler: async (ctx, { id, ownerId, attemptId }) => {
    const review = await getOwnedReview(ctx, id, ownerId);
    if (
      review.githubReview ||
      review.githubPublication?.attemptId !== attemptId ||
      !canResetPublication(review)
    )
      return false;
    await ctx.db.patch("reviews", id, {
      githubPublication: undefined,
      updatedAt: Math.max(Date.now(), review.updatedAt + 1),
    });
    return true;
  },
});

export const recover = internalMutation({
  args: { id: v.id("reviews"), ownerId: v.string(), githubReview },
  handler: async (ctx, { id, ownerId, githubReview }) => {
    const review = await getOwnedReview(ctx, id, ownerId);
    const targetPath = `/${review.repoOwner}/${review.repoName}/pull/${review.pullNumber}`;
    let url: URL;
    try {
      url = new URL(githubReview.url);
    } catch {
      throw new Error("Published review has an invalid GitHub URL.");
    }
    if (
      !Number.isSafeInteger(githubReview.id) ||
      githubReview.id < 1 ||
      url.origin !== "https://github.com" ||
      url.username ||
      url.password ||
      url.pathname.toLowerCase() !== targetPath.toLowerCase() ||
      url.hash !== `#pullrequestreview-${githubReview.id}`
    )
      throw new Error(
        "Published review does not match the target pull request.",
      );
    if (githubReview.headSha !== review.headSha)
      throw new Error("Published review does not match the saved revision.");
    if (
      review.githubReview &&
      (review.githubReview.id !== githubReview.id ||
        review.githubReview.url !== githubReview.url ||
        review.githubReview.headSha !== githubReview.headSha)
    )
      throw new Error(
        "A different GitHub review is already recorded. Refresh publication status.",
      );
    await ctx.db.patch("reviews", id, {
      githubReview: review.githubReview ?? githubReview,
      githubPublication: undefined,
    });
    return review.githubReview ?? githubReview;
  },
});
