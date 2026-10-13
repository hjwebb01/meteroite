import type { Octokit } from "octokit";
import type { Doc } from "../../../../convex/_generated/dataModel";

export type ReviewFreshness = NonNullable<Doc<"reviews">["freshness"]>;

export async function observeReviewFreshness(
  github: Octokit,
  review: Doc<"reviews">,
): Promise<ReviewFreshness> {
  if (!review.headSha || !(review.baseTipSha ?? review.baseSha))
    return {
      state: "unavailable",
      observedAt: Date.now(),
      reason:
        "This older review has no pinned base/head snapshot. Review the latest commits to establish freshness.",
    };
  try {
    const { data: live } = await github.rest.pulls.get({
      owner: review.repoOwner,
      repo: review.repoName,
      pull_number: review.pullNumber,
    });
    const current =
      live.head.sha === review.headSha &&
      live.base.sha === (review.baseTipSha ?? review.baseSha);
    return {
      state: current ? "current" : "outdated",
      headSha: live.head.sha,
      baseTipSha: live.base.sha,
      observedAt: Date.now(),
      reason: current
        ? "The PR matches this saved base/head snapshot."
        : "The PR head or base changed. Review the latest commits before publishing.",
    };
  } catch {
    return {
      state: "unavailable",
      observedAt: Date.now(),
      reason:
        "PR freshness could not be checked. Check your GitHub connection and repository access, then refresh the preview.",
    };
  }
}
