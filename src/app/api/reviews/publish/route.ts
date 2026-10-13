import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { fetchQuery } from "convex/nextjs";
import { RequestError } from "octokit";
import { z } from "zod";
import { getConvexAuth } from "@/lib/convex-auth";
import { createUserOctokit } from "@/lib/github";
import { getConvexAdminClient } from "@/lib/convex-client";
import {
  findPostedGithubReview,
  publishGithubReview,
} from "@/features/reviews/lib/github-review";
import { observeReviewFreshness } from "@/features/reviews/lib/github-freshness";
import { buildPublicationPreview } from "@/features/reviews/lib/github-publication";
import { api, internal } from "../../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../../convex/_generated/dataModel";
import type { PublishedGithubReview } from "@/features/reviews/lib/github-review";

const reviewIdSchema = z.string().min(1).max(100);
class PreviewChangedError extends Error {}

function githubErrorMessage(error: unknown) {
  if (error instanceof RequestError) {
    if (error.status === 401)
      return "GitHub rejected your connection. Reconnect your GitHub account and refresh the preview.";
    if (error.status === 403 || error.status === 404)
      return "Your GitHub account cannot comment on this pull request. Reconnect GitHub with repo (or public_repo) scope, or check your repository access.";
    if (error.status === 422)
      return "GitHub could not place this review on the saved commit. Review the latest commits and open a new preview.";
  }
  return "The publication outcome could not be confirmed. Refresh publication status before trying again; do not assume it was posted.";
}

async function recordPublication(
  review: Doc<"reviews">,
  ownerId: string,
  posted: PublishedGithubReview,
) {
  const githubReview = {
    ...posted,
    headSha: review.headSha!,
    postedAt: Date.now(),
  };
  try {
    await getConvexAdminClient().mutation(internal.reviewPublications.recover, {
      id: review._id,
      ownerId,
      githubReview,
    });
  } catch {
    // GitHub confirmed the review. Its stable marker recovers failed recording.
  }
  return githubReview;
}

export async function GET(request: Request) {
  const identity = await getConvexAuth();
  if (!identity)
    return NextResponse.json(
      { error: "Sign in to preview publication." },
      { status: 401 },
    );
  const parsed = reviewIdSchema.safeParse(
    new URL(request.url).searchParams.get("reviewId"),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid saved review." },
      { status: 400 },
    );
  let snapshot;
  try {
    snapshot = await fetchQuery(
      api.reviews.publication,
      { id: parsed.data as Id<"reviews"> },
      { token: identity.token },
    );
  } catch {
    return NextResponse.json(
      { error: "Review not found or unavailable." },
      { status: 404 },
    );
  }
  if (
    snapshot.review.status !== "completed" ||
    !snapshot.review.result ||
    !snapshot.review.headSha
  )
    return NextResponse.json(
      { error: "Only a completed saved review can be previewed." },
      { status: 409 },
    );
  let freshness: NonNullable<Doc<"reviews">["freshness"]>;
  let absenceConfirmed = false;
  try {
    const github = await createUserOctokit(identity.userId);
    freshness = await observeReviewFreshness(github, snapshot.review);
    if (!snapshot.review.githubReview) {
      const recovered = await findPostedGithubReview(github, snapshot.review);
      absenceConfirmed = !recovered;
      if (recovered)
        snapshot.review.githubReview = await recordPublication(
          snapshot.review,
          identity.userId,
          recovered,
        );
    }
  } catch {
    freshness = {
      state: "unavailable",
      observedAt: Date.now(),
      reason:
        "GitHub access is unavailable. Check your GitHub connection and repository access, then refresh the preview.",
    };
  }
  return NextResponse.json(
    { preview: buildPublicationPreview(snapshot, freshness, absenceConfirmed) },
    {
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}

export async function POST(request: Request) {
  const identity = await getConvexAuth();
  if (!identity)
    return NextResponse.json(
      { error: "Sign in to publish this review." },
      { status: 401 },
    );
  const parsed = z
    .union([
      z.object({
        reviewId: reviewIdSchema,
        confirmation: z.string().regex(/^[a-f0-9]{64}$/),
      }),
      z.object({
        reviewId: reviewIdSchema,
        action: z.literal("reset_uncertain"),
        attemptId: z.string().min(1).max(100),
      }),
    ])
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Open and confirm a fresh publication preview before posting." },
      { status: 400 },
    );
  const id = parsed.data.reviewId as Id<"reviews">;
  let snapshot;
  try {
    snapshot = await fetchQuery(
      api.reviews.publication,
      { id },
      { token: identity.token },
    );
  } catch {
    return NextResponse.json(
      { error: "Review not found or unavailable." },
      { status: 404 },
    );
  }
  const { review } = snapshot;
  if (review.githubReview)
    return NextResponse.json({ githubReview: review.githubReview });
  if (review.status !== "completed" || !review.result || !review.headSha)
    return NextResponse.json(
      { error: "Only a completed saved review can be posted to GitHub." },
      { status: 409 },
    );
  let github;
  try {
    github = await createUserOctokit(identity.userId);
    // Recovery is read-only and remains possible even when the PR has moved.
    const recovered = await findPostedGithubReview(github, review);
    if (recovered)
      return NextResponse.json({
        githubReview: await recordPublication(
          review,
          identity.userId,
          recovered,
        ),
      });
  } catch (error) {
    return NextResponse.json(
      { error: githubErrorMessage(error) },
      { status: 502 },
    );
  }
  if ("action" in parsed.data) {
    try {
      const reset = await getConvexAdminClient().mutation(
        internal.reviewPublications.reset,
        {
          id,
          ownerId: identity.userId,
          attemptId: parsed.data.attemptId,
        },
      );
      return reset
        ? NextResponse.json({ reset: true })
        : NextResponse.json(
            {
              error:
                "The attempt is still recent or publication status changed. Refresh status before resetting.",
            },
            { status: 409 },
          );
    } catch {
      return NextResponse.json(
        {
          error: "The attempt could not be reset. Refresh publication status.",
        },
        { status: 503 },
      );
    }
  }
  const confirmation = parsed.data.confirmation;
  const freshness = await observeReviewFreshness(github, review);
  const preview = buildPublicationPreview(snapshot, freshness);
  if (preview.publicationState === "recovering")
    return NextResponse.json(
      {
        error:
          "A prior publication is still running or its outcome is uncertain. Refresh publication status; no duplicate will be sent.",
        code: "publication_pending",
      },
      { status: 409 },
    );
  if (!preview.confirmation)
    return NextResponse.json(
      { error: freshness.reason, code: "freshness_blocked", preview },
      { status: 409 },
    );
  if (preview.confirmation !== confirmation)
    return NextResponse.json(
      {
        error:
          "The eligible findings, outgoing content, or PR revision changed. Refresh the preview and confirm the new output.",
        code: "preview_changed",
      },
      { status: 409 },
    );
  const attemptId = randomUUID();
  let claim;
  try {
    claim = await getConvexAdminClient().mutation(
      internal.reviewPublications.claim,
      {
        id,
        ownerId: identity.userId,
        attemptId,
        source: snapshot.source,
      },
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "Publication could not be reserved. No review was sent; refresh the preview and try again.",
      },
      { status: 503 },
    );
  }
  if (claim.state === "published")
    return NextResponse.json({ githubReview: claim.githubReview });
  if (claim.state !== "claimed")
    return NextResponse.json(
      {
        error:
          claim.state === "busy"
            ? "Publication is already running. Refresh publication status before trying again."
            : "The review changed while publication was being confirmed. Refresh the preview and confirm again.",
        code:
          claim.state === "busy" ? "publication_pending" : "preview_changed",
      },
      { status: 409 },
    );
  let remoteAttempted = false;
  try {
    const findings = review.result.findings.filter(
      (f) => !snapshot.excludedFindingIds.includes(f.id),
    );
    const posted = await publishGithubReview(
      github,
      review,
      findings,
      async () => {
        // Called before both normal publication and the possible 422 fallback.
        remoteAttempted = false;
        const live = await observeReviewFreshness(github, review);
        if (
          buildPublicationPreview(snapshot, live).confirmation !== confirmation
        )
          throw new PreviewChangedError(
            live.state === "current"
              ? "The outgoing review changed. Refresh the preview and confirm again."
              : live.reason,
          );
        // Start the deadline before authorization, so a delayed response cannot
        // resume with a new unbounded remote write after the attempt is reset.
        const signal = AbortSignal.timeout(60_000);
        const authorized = await getConvexAdminClient().mutation(
          internal.reviewPublications.authorizeWrite,
          {
            id,
            ownerId: identity.userId,
            attemptId,
          },
        );
        if (!authorized)
          throw new PreviewChangedError(
            "A finding changed after confirmation. Refresh the preview and confirm the new output.",
          );
        signal.throwIfAborted();
        remoteAttempted = true;
        return signal;
      },
    );
    return NextResponse.json({
      githubReview: await recordPublication(review, identity.userId, posted),
    });
  } catch (error) {
    const rejected =
      error instanceof RequestError &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 408;
    const uncertain = remoteAttempted && !rejected;
    if (uncertain) {
      try {
        const recovered = await findPostedGithubReview(github, review);
        if (recovered)
          return NextResponse.json({
            githubReview: await recordPublication(
              review,
              identity.userId,
              recovered,
            ),
          });
      } catch {
        // Absence or failed lookup cannot prove that the write did not happen.
      }
    }
    try {
      await getConvexAdminClient().mutation(internal.reviewPublications.fail, {
        id,
        ownerId: identity.userId,
        attemptId,
        uncertain,
      });
    } catch {
      // Keep the existing claim recoverable if persistence is unavailable.
    }
    return NextResponse.json(
      {
        error:
          error instanceof PreviewChangedError
            ? error.message
            : githubErrorMessage(error),
        code:
          error instanceof PreviewChangedError
            ? "preview_changed"
            : uncertain
              ? "publication_uncertain"
              : "publication_failed",
      },
      { status: error instanceof PreviewChangedError ? 409 : 502 },
    );
  }
}
