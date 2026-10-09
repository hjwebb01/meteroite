import type { compareReviewSnapshots } from "../../../../convex/lib/review_reassessment";
import type { EvidenceLines, ReviewOutput } from "../lib/review";
import type { ReviewBudget } from "../lib/context-budget";
import type { ReviewProvider } from "./review-agent";
import type { Snapshot } from "../lib/review-tools";

/** Run-wide inputs shared by every investigation, synthesis, and finalization step. */
export type ReviewRun = {
  reviewId: string;
  repository: { owner: string; name: string; pullNumber: number };
  snapshot: Snapshot;
  /** Prior review and its saved files, when this PR was reviewed before. */
  previous: Parameters<typeof compareReviewSnapshots>[0]["previous"] | null;
  previousFiles: Parameters<typeof compareReviewSnapshots>[0]["previousFiles"];
  previousFindings: { id: string; path: string }[];
  /** Pull request context serialized into every prompt. */
  sharedContext: Record<string, unknown>;
  provider: ReviewProvider;
  budget: ReviewBudget;
  checkActive: () => Promise<void>;
  prepareFindings: () => Promise<void>;
};

/**
 * What one investigation produced, with full in-memory evidence. Durable
 * steps must not return this shape; use `PartSummary` across step boundaries.
 */
export type PartReport = {
  output: ReviewOutput;
  evidence: EvidenceLines;
  filesRead: string[];
  warnings: string[];
};

/** A source line a part's findings or assessment cite, with its exact text. */
export type CitedLine = { path: string; line: number; text: string };

/** Serializable part result: findings validated against that part's evidence. */
export type PartSummary = {
  report: ReviewOutput;
  rejected: number;
  cited: CitedLine[];
  filesRead: string[];
  warnings: string[];
};
