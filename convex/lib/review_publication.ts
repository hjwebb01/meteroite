import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { latestVerdicts } from "./review_verdicts";

export const PUBLICATION_RECONCILE_AFTER_MS = 15 * 60_000;

export function canResetPublication(review: Doc<"reviews">) {
  const attempt = review.githubPublication;
  return (
    !!attempt?.remoteStartedAt &&
    Date.now() - attempt.remoteStartedAt >= PUBLICATION_RECONCILE_AFTER_MS
  );
}

export type PublicationSnapshot = {
  review: Doc<"reviews">;
  excludedFindingIds: string[];
  source: string;
};

// Read the same latest conclusions used by reviewInteractions.verdicts in one
// transaction with the saved review. The source binds all eligible content,
// including content omitted by GitHub's body limit, and explicit exclusions.
export async function publicationSnapshot(
  ctx: QueryCtx,
  review: Doc<"reviews">,
): Promise<PublicationSnapshot> {
  const verdicts = await latestVerdicts(ctx, review);
  const excludedFindingIds = (review.result?.findings ?? [])
    .filter((finding) => verdicts[finding.id] === "incorrect")
    .map((finding) => finding.id);
  return {
    review,
    excludedFindingIds,
    source: JSON.stringify({
      id: review._id,
      ownerId: review.ownerId,
      repoOwner: review.repoOwner,
      repoName: review.repoName,
      pullNumber: review.pullNumber,
      status: review.status,
      updatedAt: review.updatedAt,
      headSha: review.headSha,
      baseTipSha: review.baseTipSha ?? review.baseSha,
      summary: review.result?.summary,
      findings: review.result?.findings,
      excludedFindingIds,
      verdicts,
    }),
  };
}
