import { createHash } from "node:crypto";
import type { Doc } from "../../../../convex/_generated/dataModel";
import type { PublicationSnapshot } from "../../../../convex/lib/review_publication";
import { canResetPublication } from "../../../../convex/lib/review_publication";
import { buildGithubReview, type GithubReviewPayload } from "./github-review";
import type { ReviewFreshness } from "./github-freshness";

export type ReviewPublicationPreviewData = {
  target: {
    repoOwner: string;
    repoName: string;
    pullNumber: number;
    headSha: string;
    baseTipSha: string;
    event: "COMMENT";
  };
  normal: GithubReviewPayload;
  fallback: GithubReviewPayload;
  excludedFindings: { id: string; title: string }[];
  freshness: ReviewFreshness;
  confirmation: string | null;
  publicationState: "ready" | "blocked" | "recovering" | "published";
  githubReview?: Doc<"reviews">["githubReview"];
  resetAttemptId: string | null;
};

export function buildPublicationPreview(
  snapshot: PublicationSnapshot,
  freshness: ReviewFreshness,
  absenceConfirmed = false,
): ReviewPublicationPreviewData {
  const { review, excludedFindingIds, source } = snapshot;
  const excluded = new Set(excludedFindingIds);
  const findings = (review.result?.findings ?? []).filter(
    (f) => !excluded.has(f.id),
  );
  const target: ReviewPublicationPreviewData["target"] = {
    repoOwner: review.repoOwner,
    repoName: review.repoName,
    pullNumber: review.pullNumber,
    headSha: review.headSha ?? "",
    baseTipSha: review.baseTipSha ?? review.baseSha ?? "",
    event: "COMMENT",
  };
  const normal = buildGithubReview(review, findings);
  const fallback = buildGithubReview(review, findings, { inline: false });
  const blocked =
    review.status !== "completed" ||
    !review.result ||
    !target.headSha ||
    !target.baseTipSha ||
    freshness.state !== "current";
  const recovering =
    !!review.githubPublication &&
    (!!review.githubPublication.remoteStartedAt ||
      Date.now() - review.githubPublication.startedAt < 60_000);
  const confirmation =
    blocked || recovering || review.githubReview
      ? null
      : createHash("sha256")
          .update(
            JSON.stringify({
              version: 1,
              source,
              target,
              live:
                freshness.state === "current"
                  ? {
                      headSha: freshness.headSha,
                      baseTipSha: freshness.baseTipSha,
                    }
                  : null,
              normal,
              fallback,
            }),
          )
          .digest("hex");
  return {
    target,
    normal,
    fallback,
    excludedFindings: (review.result?.findings ?? [])
      .filter((f) => excluded.has(f.id))
      .map((f) => ({ id: f.id, title: f.title })),
    freshness,
    confirmation,
    publicationState: review.githubReview
      ? "published"
      : recovering
        ? "recovering"
        : blocked
          ? "blocked"
          : "ready",
    githubReview: review.githubReview,
    resetAttemptId:
      absenceConfirmed && !review.githubReview && canResetPublication(review)
        ? review.githubPublication!.attemptId
        : null,
  };
}
