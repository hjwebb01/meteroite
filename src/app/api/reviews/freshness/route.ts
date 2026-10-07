import { NextResponse } from "next/server";
import { fetchQuery } from "convex/nextjs";
import { z } from "zod";
import { getConvexAuth } from "@/lib/convex-auth";
import { createUserOctokit } from "@/lib/github";
import { getConvexAdminClient } from "@/lib/convex-client";
import { api, internal } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

export async function POST(request: Request) {
  const identity = await getConvexAuth();
  if (!identity)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = z
    .object({ reviewId: z.string().min(1).max(100) })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid review" }, { status: 400 });
  const id = parsed.data.reviewId as Id<"reviews">;
  let review;
  try {
    review = await fetchQuery(
      api.reviews.get,
      { id },
      { token: identity.token },
    );
  } catch {
    return NextResponse.json(
      { error: "Review not found or unavailable" },
      { status: 404 },
    );
  }
  let observation;
  try {
    if (!review.headSha || !(review.baseTipSha ?? review.baseSha))
      throw new Error("Saved snapshot unavailable");
    const github = await createUserOctokit(identity.userId);
    const { data: live } = await github.rest.pulls.get({
      owner: review.repoOwner,
      repo: review.repoName,
      pull_number: review.pullNumber,
    });
    const current =
      live.head.sha === review.headSha &&
      live.base.sha === (review.baseTipSha ?? review.baseSha);
    observation = {
      state: current ? ("current" as const) : ("outdated" as const),
      headSha: live.head.sha,
      baseTipSha: live.base.sha,
      observedAt: Date.now(),
      reason: current
        ? "The PR matches this saved base/head snapshot."
        : "The PR has newer head or base commits. Start a new assessment to review current code.",
    };
  } catch {
    observation = {
      state: "unavailable" as const,
      observedAt: Date.now(),
      reason:
        !review.headSha || !(review.baseTipSha ?? review.baseSha)
          ? "This older review has no pinned base/head snapshot. Start a new assessment to establish freshness."
          : "PR freshness could not be refreshed. Check your GitHub connection and repository access, then try again.",
    };
  }
  try {
    await getConvexAdminClient().mutation(internal.reviewJobs.recordFreshness, {
      id,
      ownerId: identity.userId,
      observation,
    });
  } catch {
    return NextResponse.json(
      { error: "The freshness observation could not be saved. Try again." },
      { status: 503 },
    );
  }
  return NextResponse.json({ observation });
}
