import { paginationOptsValidator } from "convex/server";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { verifyAuth } from "./auth";
import { isReviewModelId } from "./lib/review_models";
import { getOwnedReview } from "./lib/owned_review";
import { publicationSnapshot } from "./lib/review_publication";

export type ReviewHistoryRow = {
  _id: Doc<"reviews">["_id"];
  _creationTime: number;
  repoOwner: string;
  repoName: string;
  pullNumber: number;
  title?: string;
  status: Doc<"reviews">["status"];
  findingCount?: number;
  readCount: number;
  sectionCount: number;
  headSha?: string;
  freshnessState?: "current" | "outdated" | "unavailable";
  githubReviewUrl?: string;
};

async function sectionReads(ctx: QueryCtx, review: Doc<"reviews">) {
  if (review.status !== "completed" || !review.result || !review.headSha)
    return [];
  const groups = new Set(review.result.changeGroups?.map((group) => group.id));
  const marks = await ctx.db
    .query("reviewSectionReads")
    .withIndex("by_owner_review_head_group", (q) =>
      q
        .eq("ownerId", review.ownerId)
        .eq("reviewId", review._id)
        .eq("headSha", review.headSha!),
    )
    .collect();
  return marks
    .filter((mark) => groups.has(mark.groupId))
    .map((mark) => mark.groupId);
}

async function historyRow(
  ctx: QueryCtx,
  review: Doc<"reviews">,
): Promise<ReviewHistoryRow> {
  return {
    _id: review._id,
    _creationTime: review._creationTime,
    repoOwner: review.repoOwner,
    repoName: review.repoName,
    pullNumber: review.pullNumber,
    title: review.title,
    status: review.status,
    findingCount: review.result?.findings.length,
    readCount: (await sectionReads(ctx, review)).length,
    sectionCount:
      review.status === "completed"
        ? new Set(review.result?.changeGroups?.map((group) => group.id)).size
        : 0,
    headSha: review.headSha,
    freshnessState: review.freshness?.state,
    githubReviewUrl: review.githubReview?.url,
  };
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await verifyAuth(ctx);
    const reviews = await ctx.db
      .query("reviews")
      .withIndex("by_owner", (q) => q.eq("ownerId", identity.subject))
      .order("desc")
      .take(50);
    return reviews.map((review) => ({
      _id: review._id,
      _creationTime: review._creationTime,
      repoOwner: review.repoOwner,
      repoName: review.repoName,
      pullNumber: review.pullNumber,
      title: review.title,
      status: review.status,
      findingCount: review.result?.findings.length,
    }));
  },
});

export const history = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const identity = await verifyAuth(ctx);
    const page = await ctx.db
      .query("reviews")
      .withIndex("by_owner", (q) => q.eq("ownerId", identity.subject))
      .order("desc")
      .paginate(paginationOpts);
    return {
      ...page,
      page: await Promise.all(
        page.page.map((review) => historyRow(ctx, review)),
      ),
    };
  },
});

export const readSections = query({
  args: { id: v.id("reviews") },
  handler: async (ctx, { id }) => {
    const identity = await verifyAuth(ctx);
    return sectionReads(ctx, await getOwnedReview(ctx, id, identity.subject));
  },
});

export const setSectionRead = mutation({
  args: {
    id: v.id("reviews"),
    headSha: v.string(),
    groupId: v.string(),
    read: v.boolean(),
  },
  handler: async (ctx, { id, headSha, groupId, read }) => {
    const identity = await verifyAuth(ctx);
    const review = await getOwnedReview(ctx, id, identity.subject);
    if (
      review.status !== "completed" ||
      !review.result ||
      !review.headSha ||
      review.headSha !== headSha
    )
      throw new Error("Reading marks require the completed saved revision.");
    if (!review.result.changeGroups?.some((group) => group.id === groupId))
      throw new Error("Saved change section not found.");
    const mark = await ctx.db
      .query("reviewSectionReads")
      .withIndex("by_owner_review_head_group", (q) =>
        q
          .eq("ownerId", identity.subject)
          .eq("reviewId", id)
          .eq("headSha", headSha)
          .eq("groupId", groupId),
      )
      .unique();
    if (read && !mark)
      await ctx.db.insert("reviewSectionReads", {
        ownerId: identity.subject,
        reviewId: id,
        headSha,
        groupId,
        markedAt: Date.now(),
      });
    if (!read && mark) await ctx.db.delete("reviewSectionReads", mark._id);
  },
});

export const publication = query({
  args: { id: v.id("reviews") },
  handler: async (ctx, { id }) => {
    const identity = await verifyAuth(ctx);
    return publicationSnapshot(
      ctx,
      await getOwnedReview(ctx, id, identity.subject),
    );
  },
});

export const get = query({
  args: { id: v.id("reviews") },
  handler: async (ctx, { id }) => {
    const identity = await verifyAuth(ctx);
    const review = await getOwnedReview(ctx, id, identity.subject);
    return review;
  },
});

export const files = query({
  args: { id: v.id("reviews") },
  handler: async (ctx, { id }) => {
    const identity = await verifyAuth(ctx);
    await getOwnedReview(ctx, id, identity.subject);
    return ctx.db
      .query("reviewFiles")
      .withIndex("by_review_filename", (q) => q.eq("reviewId", id))
      .take(200);
  },
});

export const start = mutation({
  args: {
    repoOwner: v.string(),
    repoName: v.string(),
    pullNumber: v.number(),
    model: v.string(),
    instructions: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    if (!isReviewModelId(args.model))
      throw new Error("Unsupported review model");
    if (
      !/^[A-Za-z0-9-]{1,100}$/.test(args.repoOwner) ||
      !/^[A-Za-z0-9_.-]{1,100}$/.test(args.repoName) ||
      args.repoName === "." ||
      args.repoName === ".." ||
      !Number.isSafeInteger(args.pullNumber) ||
      args.pullNumber < 1 ||
      args.instructions.length > 4000
    )
      throw new Error("Invalid review request");
    const repoOwner = args.repoOwner.toLowerCase();
    const repoName = args.repoName.toLowerCase();
    const url = `https://github.com/${repoOwner}/${repoName}/pull/${args.pullNumber}`;
    const recent = await ctx.db
      .query("reviews")
      .withIndex("by_owner_url", (q) =>
        q.eq("ownerId", identity.subject).eq("url", url),
      )
      .order("desc")
      .take(50);
    const active = recent.find(
      (r) => r.status === "queued" || r.status === "running",
    );
    if (active) return { id: active._id, created: false };
    const previous = recent.find((r) => r.status === "completed");
    const id = await ctx.db.insert("reviews", {
      ...args,
      repoOwner,
      repoName,
      url,
      ownerId: identity.subject,
      status: "queued",
      progress: "Waiting to start",
      updatedAt: Date.now(),
      previousReviewId: previous?._id,
    });
    return { id, created: true };
  },
});

export const cancel = mutation({
  args: { id: v.id("reviews") },
  handler: async (ctx, { id }) => {
    const identity = await verifyAuth(ctx);
    const review = await getOwnedReview(ctx, id, identity.subject);
    if (review.status !== "queued" && review.status !== "running") return;
    await ctx.db.patch("reviews", id, {
      status: "cancelled",
      progress: "Review cancelled",
      updatedAt: Date.now(),
    });
  },
});

export const failToQueue = mutation({
  args: { id: v.id("reviews") },
  handler: async (ctx, { id }) => {
    const identity = await verifyAuth(ctx);
    const review = await getOwnedReview(ctx, id, identity.subject);
    if (review.status !== "queued") return;
    await ctx.db.patch("reviews", id, {
      status: "failed",
      error: "The review could not be queued. Try again.",
      progress: "Could not start",
      updatedAt: Date.now(),
    });
  },
});

export const groupingFeedback = query({
  args: { id: v.id("reviews") },
  handler: async (ctx, { id }) => {
    const identity = await verifyAuth(ctx);
    await getOwnedReview(ctx, id, identity.subject);
    return ctx.db
      .query("reviewGroupingFeedback")
      .withIndex("by_review", (q) => q.eq("reviewId", id))
      .collect();
  },
});

export const flagGrouping = mutation({
  args: {
    id: v.id("reviews"),
    groupId: v.string(),
    requestId: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, { id, groupId, requestId, reason }) => {
    const identity = await verifyAuth(ctx);
    const review = await getOwnedReview(ctx, id, identity.subject);
    if (!review.result?.changeGroups?.some((group) => group.id === groupId))
      throw new Error("Change group not found");
    const trimmed = reason.trim();
    if (
      !trimmed ||
      trimmed.length > 1000 ||
      !requestId ||
      requestId.length > 100
    )
      throw new Error("Invalid grouping feedback");
    const existing = await ctx.db
      .query("reviewGroupingFeedback")
      .withIndex("by_owner_request", (q) =>
        q.eq("ownerId", identity.subject).eq("requestId", requestId),
      )
      .unique();
    if (existing) {
      if (
        existing.reviewId !== id ||
        existing.groupId !== groupId ||
        existing.reason !== trimmed
      )
        throw new Error("Feedback request already used");
      return existing._id;
    }
    return ctx.db.insert("reviewGroupingFeedback", {
      reviewId: id,
      ownerId: identity.subject,
      groupId,
      requestId,
      reason: trimmed,
      createdAt: Date.now(),
    });
  },
});
