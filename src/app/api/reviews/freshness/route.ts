import { NextResponse } from "next/server";
import { fetchQuery } from "convex/nextjs";
import { z } from "zod";
import { getConvexAuth } from "@/lib/convex-auth";
import { createUserOctokit } from "@/lib/github";
import { getConvexAdminClient } from "@/lib/convex-client";
import { api, internal } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { observeReviewFreshness } from "@/features/reviews/lib/github-freshness";

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
    const github = await createUserOctokit(identity.userId);
    observation = await observeReviewFreshness(github, review);
  } catch {
    observation = {
      state: "unavailable" as const,
      observedAt: Date.now(),
      reason:
        "PR freshness could not be checked. Check your GitHub connection and repository access, then try again.",
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
