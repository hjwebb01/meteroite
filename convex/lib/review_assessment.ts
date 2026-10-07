import { z } from "zod";

export const SCRUTINY_GUIDANCE = {
  1: {
    label: "Routine",
    guidance: "Straightforward changes needing a quick human check.",
  },
  2: { label: "Limited", guidance: "A few specific areas need attention." },
  3: {
    label: "Focused",
    guidance: "Inspect identified hotspots and surrounding behavior.",
  },
  4: {
    label: "Extensive",
    guidance: "Review interactions across affected systems.",
  },
  5: {
    label: "Critical",
    guidance:
      "Careful review by someone with relevant expertise before merging.",
  },
} as const;

export const SCRUTINY_RUBRIC = {
  version: "conservative-v1",
  dimensions: {
    impact: [
      "Local, reversible effects",
      "Limited user-visible behavior",
      "Important user or data behavior",
      "Broad security, data or availability effects",
      "Potential irreversible loss or critical security boundary",
    ],
    complexity: [
      "One straightforward behavior",
      "A few related paths",
      "Several interacting paths",
      "Interactions across systems",
      "Critical cross-system invariants require specialist review",
    ],
    uncertainty: [
      "Behavior and callers are understood",
      "A few explicit assumptions",
      "Important assumptions need confirmation",
      "Major contracts remain uncertain",
      "Critical behavior requires expertise to establish",
    ],
    coverage: [
      "Relevant changes and callers inspected",
      "Small, explicit coverage gaps",
      "Important paths need human inspection",
      "Substantial affected-system coverage gaps",
      "Critical paths remain unverified despite enough evidence to identify their risk",
    ],
  },
} as const;

const level = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);
const reason = z.object({ level, reason: z.string().min(1).max(700) });
const dimensions = z.object({
  impact: reason,
  complexity: reason,
  uncertainty: reason,
  coverage: reason,
});
const evidence = z.object({
  path: z.string().min(1).max(500),
  line: z.number().int().positive(),
  quote: z.string().min(8).max(500),
});

export const assessmentDraftSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("complete"),
    dimensions,
    evidence: z.array(evidence).min(1).max(8),
  }),
  z.object({
    state: z.literal("incomplete"),
    missingEvidence: z.array(z.string().min(1).max(700)).min(1).max(10),
  }),
]);
const responseReason = reason.extend({
  level: z.number().describe("Integer from 1 to 5. Use the supplied rubric."),
});
export const assessmentResponseSchema = z.union([
  assessmentDraftSchema.options[0].extend({
    dimensions: z.object({
      impact: responseReason,
      complexity: responseReason,
      uncertainty: responseReason,
      coverage: responseReason,
    }),
  }),
  assessmentDraftSchema.options[1],
]);
export type AssessmentDraft = z.infer<typeof assessmentDraftSchema>;
export type ScrutinyScore = z.infer<typeof level>;
export type AssessmentDimensions = z.infer<typeof dimensions>;

type Observation<T> = { headSha: string; observedAt: number } & (
  | { state: "known"; value: T }
  | { state: "unknown" | "unavailable"; reason: string }
);
export type ReviewSignals = {
  draft: Observation<boolean>;
  checks: Observation<"passed" | "failed" | "pending" | "none">;
};

const observationFields = {
  headSha: z.string().min(1),
  observedAt: z.number().int().nonnegative(),
};
function observation<T extends z.ZodType>(value: T) {
  return z.union([
    z.object({ ...observationFields, state: z.literal("known"), value }),
    z.object({
      ...observationFields,
      state: z.enum(["unknown", "unavailable"]),
      reason: z.string().min(1).max(700),
    }),
  ]);
}
const common = {
  rubricVersion: z.literal("conservative-v1"),
  headSha: z.string().min(1),
  baseSha: z.string().min(1),
  assessedAt: z.number().int().nonnegative(),
  signals: z.object({
    draft: observation(z.boolean()),
    checks: observation(z.enum(["passed", "failed", "pending", "none"])),
  }),
  readiness: z.object({
    state: z.enum(["ready_for_review", "needs_attention", "incomplete"]),
    reasons: z.array(z.string().min(1).max(700)).min(1).max(30),
  }),
  coverageReasons: z.array(z.string().max(700)).max(100),
};
export const persistedAssessmentSchema = z
  .discriminatedUnion("state", [
    z.object({
      ...common,
      state: z.literal("complete"),
      score: level,
      dimensions,
      evidence: z.array(evidence).min(1).max(8),
    }),
    z.object({
      ...common,
      state: z.literal("incomplete"),
      missingEvidence: z.array(z.string().min(1).max(700)).min(1).max(10),
    }),
  ])
  .superRefine((assessment, ctx) => {
    if (
      assessment.state === "complete" &&
      assessment.score !==
        Math.max(
          ...Object.values(assessment.dimensions).map((entry) => entry.level),
        )
    )
      ctx.addIssue({
        code: "custom",
        message: "Scrutiny must reflect the strongest dimension",
        path: ["score"],
      });
    if (
      assessment.signals.draft.headSha !== assessment.headSha ||
      assessment.signals.checks.headSha !== assessment.headSha
    )
      ctx.addIssue({
        code: "custom",
        message: "Assessment observations must refer to the reviewed head",
      });
  });
export type PersistedAssessment = z.infer<typeof persistedAssessmentSchema>;
export type Assessment =
  PersistedAssessment | { state: "legacy"; reason: string };

export function readAssessment(saved?: PersistedAssessment): Assessment {
  return (
    saved ?? {
      state: "legacy",
      reason:
        "This saved review predates PR assessments. Review the latest commits to generate one.",
    }
  );
}

export function createAssessment({
  draft,
  headSha,
  baseSha,
  signals,
  evidenceLines,
  findings,
  coverageReasons,
  assessedAt,
}: {
  draft: unknown;
  headSha: string;
  baseSha: string;
  signals: ReviewSignals;
  evidenceLines: Map<string, Map<number, string>>;
  findings: { severity: "high" | "medium" | "low" }[];
  coverageReasons: string[];
  assessedAt: number;
}): PersistedAssessment {
  const parsed = assessmentDraftSchema.safeParse(draft);
  const validDraft = parsed.success
    ? parsed.data
    : {
        state: "incomplete" as const,
        missingEvidence: ["The assessment response could not be validated."],
      };
  const supported =
    validDraft.state === "complete" &&
    validDraft.evidence.every((item) => {
      const line = evidenceLines.get(item.path)?.get(item.line);
      return (
        line !== undefined &&
        item.quote.trim().length >= 8 &&
        line.includes(item.quote.trim())
      );
    });
  const interpretation =
    validDraft.state === "complete" && supported
      ? {
          ...validDraft,
          score: Math.max(
            ...Object.values(validDraft.dimensions).map((entry) => entry.level),
          ) as ScrutinyScore,
        }
      : {
          state: "incomplete" as const,
          missingEvidence:
            validDraft.state === "incomplete"
              ? validDraft.missingEvidence
              : [
                  "The assessment's source evidence could not be validated against inspected code.",
                ],
        };
  const blockers: string[] = [];
  const unknowns: string[] = [];
  const reasons: string[] = [];
  if (signals.draft.state === "known") {
    reasons.push(
      signals.draft.value
        ? "The PR was observed as a draft."
        : "The PR was observed as open for review.",
    );
    if (signals.draft.value) blockers.push("The PR is still a draft.");
  } else unknowns.push(signals.draft.reason);
  if (signals.checks.state === "known") {
    const messages = {
      passed: "Observed CI/checks passed for the reviewed commit.",
      failed: "Observed CI/checks failed for the reviewed commit.",
      pending: "CI/checks are still pending for the reviewed commit.",
      none: "No CI/checks were observed for the reviewed commit.",
    };
    reasons.push(messages[signals.checks.value]);
    if (signals.checks.value === "failed" || signals.checks.value === "pending")
      blockers.push(messages[signals.checks.value]);
  } else unknowns.push(signals.checks.reason);
  if (findings.some((finding) => finding.severity === "high"))
    blockers.push("Validated high-severity findings need attention.");
  reasons.push(
    `${findings.length} validated finding${findings.length === 1 ? "" : "s"}. Findings do not approve merging.`,
  );
  if (interpretation.state === "incomplete")
    unknowns.push(...interpretation.missingEvidence);
  if (coverageReasons.length)
    reasons.push(
      "Coverage limitations remain. Inspect the recorded gaps before relying on this review.",
    );
  return persistedAssessmentSchema.parse({
    ...interpretation,
    rubricVersion: SCRUTINY_RUBRIC.version,
    headSha,
    baseSha,
    assessedAt,
    signals,
    readiness: {
      state: blockers.length
        ? "needs_attention"
        : unknowns.length
          ? "incomplete"
          : "ready_for_review",
      reasons: [...new Set([...blockers, ...unknowns, ...reasons])],
    },
    coverageReasons: coverageReasons
      .slice(0, 100)
      .map((entry) => entry.slice(0, 700)),
  });
}
