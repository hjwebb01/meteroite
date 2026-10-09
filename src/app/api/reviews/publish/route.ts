import { NextResponse } from "next/server";
import { fetchQuery } from "convex/nextjs";
import { RequestError } from "octokit";
import { z } from "zod";
import { getConvexAuth } from "@/lib/convex-auth";
import { createUserOctokit } from "@/lib/github";
import { getConvexAdminClient } from "@/lib/convex-client";
import { publishGithubReview } from "@/features/reviews/lib/github-review";
import { api, internal } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

function githubErrorMessage(error: unknown) {
  if (error instanceof RequestError) {
    if (error.status === 401)
      return "GitHub rejected your connection. Reconnect your GitHub account and try again.";
    if (error.status === 403 || error.status === 404)
      return "Your GitHub account cannot comment on this pull request. Reconnect GitHub with repo (or public_repo) scope, or check your repository access.";
    if (error.status === 422)
      return "GitHub could not place this review on the reviewed commit. It may no longer belong to the pull request; review the latest commits and post again.";
  }
  return "The review could not be posted to GitHub. Try again.";
}

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
  let review, verdicts;
  try {
    [review, verdicts] = await Promise.all([
      fetchQuery(api.reviews.get, { id }, { token: identity.token }),
      fetchQuery(
        api.reviewInteractions.verdicts,
        { reviewId: id },
        { token: identity.token },
      ),
    ]);
  } catch {
    return NextResponse.json(
      { error: "Review not found or unavailable" },
      { status: 404 },
    );
  }
  if (review.githubReview)
    return NextResponse.json({ githubReview: review.githubReview });
  if (review.status !== "completed" || !review.result || !review.headSha)
    return NextResponse.json(
      { error: "Only a completed review can be posted to GitHub." },
      { status: 409 },
    );
  // Findings the investigation retracted are not worth a reviewer's time.
  const findings = review.result.findings.filter(
    (f) => verdicts[f.id] !== "incorrect",
  );
  let posted;
  try {
    const github = await createUserOctokit(identity.userId);
    posted = await publishGithubReview(github, review, findings);
  } catch (error) {
    return NextResponse.json(
      { error: githubErrorMessage(error) },
      { status: 502 },
    );
  }
  const githubReview = {
    ...posted,
    headSha: review.headSha,
    postedAt: Date.now(),
  };
  try {
    await getConvexAdminClient().mutation(
      internal.reviewJobs.recordGithubReview,
      { id, ownerId: identity.userId, githubReview },
    );
  } catch {
    // The post is on GitHub; posting again finds it by its marker.
  }
  return NextResponse.json({ githubReview });
}
