import { v } from "convex/values";

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
});

const observationFields = { headSha: v.string(), observedAt: v.number() };
const draftObservation = v.union(
  v.object({
    ...observationFields,
    state: v.literal("known"),
    value: v.boolean(),
  }),
  v.object({
    ...observationFields,
    state: v.union(v.literal("unknown"), v.literal("unavailable")),
    reason: v.string(),
  }),
);
const checkObservation = v.union(
  v.object({
    ...observationFields,
    state: v.literal("known"),
    value: v.union(
      v.literal("passed"),
      v.literal("failed"),
      v.literal("pending"),
      v.literal("none"),
    ),
  }),
  v.object({
    ...observationFields,
    state: v.union(v.literal("unknown"), v.literal("unavailable")),
    reason: v.string(),
  }),
);
const scrutinyScore = v.union(
  v.literal(1),
  v.literal(2),
  v.literal(3),
  v.literal(4),
  v.literal(5),
);
const assessmentReason = v.object({ level: scrutinyScore, reason: v.string() });
const assessmentFields = {
  rubricVersion: v.literal("conservative-v1"),
  headSha: v.string(),
  baseSha: v.string(),
  assessedAt: v.number(),
  signals: v.object({ draft: draftObservation, checks: checkObservation }),
  readiness: v.object({
    state: v.union(
      v.literal("ready_for_review"),
      v.literal("needs_attention"),
      v.literal("incomplete"),
    ),
    reasons: v.array(v.string()),
  }),
  coverageReasons: v.array(v.string()),
};
export const reviewAssessment = v.union(
  v.object({
    ...assessmentFields,
    state: v.literal("complete"),
    score: scrutinyScore,
    dimensions: v.object({
      impact: assessmentReason,
      complexity: assessmentReason,
      uncertainty: assessmentReason,
      coverage: assessmentReason,
    }),
    evidence: v.array(
      v.object({ path: v.string(), line: v.number(), quote: v.string() }),
    ),
  }),
  v.object({
    ...assessmentFields,
    state: v.literal("incomplete"),
    missingEvidence: v.array(v.string()),
  }),
);

export const codeReference = v.object({
  path: v.string(),
  sourcePath: v.string(),
  line: v.number(),
  side: v.union(v.literal("LEFT"), v.literal("RIGHT")),
  commitSha: v.string(),
  blobSha: v.optional(v.string()),
});
export const reviewHotspot = v.object({
  id: v.string(),
  kind: v.union(v.literal("possible_issue"), v.literal("human_judgment")),
  title: v.string(),
  reason: v.string(),
  references: v.array(codeReference),
});
export const fileCoverageGap = v.object({
  kind: v.union(
    v.literal("text_patch_unavailable"),
    v.literal("model_context_omitted"),
    v.literal("display_size_excluded"),
  ),
  reason: v.string(),
});

export const changeHunk = v.object({
  id: v.string(),
  path: v.string(),
  ordinal: v.number(),
  leftStart: v.number(),
  leftLines: v.number(),
  rightStart: v.number(),
  rightLines: v.number(),
  heading: v.string(),
});
export const changeGroup = v.object({
  id: v.string(),
  title: v.string(),
  purpose: v.string(),
  hunkIds: v.array(v.string()),
});

export const reviewReassessment = v.object({
  sourceReviewId: v.string(),
  sourceHeadSha: v.optional(v.string()),
  sourceBaseSha: v.optional(v.string()),
  headSha: v.string(),
  comparedAt: v.number(),
  contexts: v.array(
    v.object({
      kind: v.union(
        v.literal("finding"),
        v.literal("hotspot"),
        v.literal("group"),
      ),
      sourceId: v.string(),
      state: v.union(
        v.literal("unchanged"),
        v.literal("changed"),
        v.literal("ambiguous"),
      ),
      reason: v.string(),
      currentPaths: v.array(v.string()),
      currentId: v.optional(v.string()),
    }),
  ),
  absentFindingIds: v.array(v.string()),
});
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
