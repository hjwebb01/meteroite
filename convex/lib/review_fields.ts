import { v } from "convex/values";
import { persistedAssessmentSchema } from "./review_assessment";
import {
  changeGroupSchema,
  changeHunkSchema,
  codeReferenceSchema,
  hotspotSchema,
} from "./review_navigation";
import { reassessmentSchema } from "./review_reassessment";
import { zodValidator } from "./zod_validator";

export const FINDING_CATEGORIES = [
  "bug",
  "security",
  "performance",
  "data_integrity",
  "test_gap",
  "maintainability",
] as const;

export const reviewFinding = v.object({
  id: v.string(),
  severity: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
  title: v.string(),
  path: v.string(),
  anchorPath: v.optional(v.string()),
  line: v.number(),
  side: v.union(v.literal("LEFT"), v.literal("RIGHT")),
  explanation: v.string(),
  suggestion: v.string(),
  evidence: v.array(
    v.object({
      path: v.string(),
      line: v.number(),
      quote: v.string(),
      commitSha: v.optional(v.string()),
      blobSha: v.optional(v.string()),
    }),
  ),
  previousFindingId: v.union(v.string(), v.null()),
  // Absent on reviews saved before findings were categorised and scored.
  category: v.optional(
    v.union(...FINDING_CATEGORIES.map((category) => v.literal(category))),
  ),
  confidence: v.optional(
    v.union(
      v.literal(1),
      v.literal(2),
      v.literal(3),
      v.literal(4),
      v.literal(5),
    ),
  ),
});

export const reviewAssessment = zodValidator(persistedAssessmentSchema);
export const codeReference = zodValidator(codeReferenceSchema);
export const reviewHotspot = zodValidator(hotspotSchema);
export const fileCoverageGap = v.object({
  kind: v.union(
    v.literal("text_patch_unavailable"),
    v.literal("model_context_omitted"),
    v.literal("display_size_excluded"),
  ),
  reason: v.string(),
});

export const changeHunk = zodValidator(changeHunkSchema);
export const changeGroup = zodValidator(changeGroupSchema);

export const reviewReassessment = zodValidator(reassessmentSchema);
export const reviewFreshness = v.union(
  v.object({
    state: v.union(v.literal("current"), v.literal("outdated")),
    headSha: v.string(),
    baseTipSha: v.string(),
    observedAt: v.number(),
    reason: v.string(),
  }),
  v.object({
    state: v.literal("unavailable"),
    observedAt: v.number(),
    reason: v.string(),
  }),
);
// The pull request review posted to GitHub from this saved review.
export const githubReview = v.object({
  id: v.number(),
  url: v.string(),
  headSha: v.string(),
  postedAt: v.number(),
});
export const reviewResult = {
  reassessment: v.optional(reviewReassessment),
  changeGroups: v.optional(v.array(changeGroup)),
  assessment: v.optional(reviewAssessment),
  hotspots: v.optional(v.array(reviewHotspot)),
  summary: v.string(),
  findings: v.array(reviewFinding),
  coverage: v.object({
    changedFiles: v.number(),
    diffFiles: v.array(v.string()),
    filesRead: v.array(v.string()),
    warnings: v.array(v.string()),
  }),
  outdated: v.boolean(),
};

export const reviewFileDiff = v.object({
  filename: v.string(),
  previousFilename: v.optional(v.string()),
  status: v.string(),
  patch: v.optional(v.string()),
  omittedReason: v.optional(v.string()),
  coverageGaps: v.optional(v.array(fileCoverageGap)),
  headBlobSha: v.optional(v.string()),
  leftBlobSha: v.optional(v.string()),
  hunks: v.optional(v.array(changeHunk)),
  changedLineRanges: v.optional(
    v.object({
      LEFT: v.array(v.object({ start: v.number(), end: v.number() })),
      RIGHT: v.array(v.object({ start: v.number(), end: v.number() })),
    }),
  ),
});
