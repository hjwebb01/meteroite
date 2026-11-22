import type { compareReviewSnapshots } from "../../../../convex/lib/review_reassessment";
import type { EvidenceLines, ReviewOutput } from "../lib/review";
import type { ReviewBudget } from "../lib/context-budget";
import type { ReviewProvider } from "./review-agent";
import type { Snapshot } from "../lib/review-tools";

export type ReviewRun = {
  reviewId: string;
  repository: { owner: string; name: string; pullNumber: number };
  snapshot: Snapshot;
  previous: Parameters<typeof compareReviewSnapshots>[0]["previous"] | null;
  previousFiles: Parameters<typeof compareReviewSnapshots>[0]["previousFiles"];
  previousFindings: { id: string; path: string }[];
  sharedContext: Record<string, unknown>;
  provider: ReviewProvider;
  budget: ReviewBudget;
  checkActive: () => Promise<void>;
  prepareFindings: () => Promise<void>;
  reportAction: (
    tool: string,
    action: string,
    target?: { path?: string; start?: number; end?: number },
  ) => Promise<void>;
};

export type PartReport = {
  output: ReviewOutput;
  evidence: EvidenceLines;
  filesRead: string[];
  warnings: string[];
};

type CitedLine = { path: string; line: number; text: string };

export type PartSummary = {
  report: ReviewOutput;
  rejected: number;
  cited: CitedLine[];
  filesRead: string[];
  warnings: string[];
};
