import { describe, expect, test } from "vitest";
import {
  createAssessment,
  persistedAssessmentSchema,
  readAssessment,
  type ReviewSignals,
} from "./review_assessment";
import { assessmentCalibrationFixtures } from "../../src/features/reviews/lib/assessment-fixtures";

const signals: ReviewSignals = {
  draft: { state: "known", value: false, headSha: "head", observedAt: 100 },
  checks: { state: "known", value: "passed", headSha: "head", observedAt: 110 },
};
function assess(
  draft: unknown,
  overrides: Partial<Parameters<typeof createAssessment>[0]> = {},
) {
  return createAssessment({
    draft,
    headSha: "head",
    baseSha: "base",
    signals,
    evidenceLines: new Map([
      ["README.md", new Map([[1, assessmentCalibrationFixtures[0].source]])],
    ]),
    findings: [],
    coverageReasons: [],
    assessedAt: 120,
    ...overrides,
  });
}

describe("human scrutiny and readiness", () => {
  test.each(assessmentCalibrationFixtures)(
    "calibrates $name with no bug finding",
    (fixture) => {
      const result = assess(fixture.assessment, {
        evidenceLines: new Map([["README.md", new Map([[1, fixture.source]])]]),
      });
      expect(result).toMatchObject({
        state: "complete",
        score: fixture.expectedScore,
        readiness: { state: "ready_for_review" },
        headSha: "head",
        baseSha: "base",
      });
    },
  );
  test("uses the strongest dimension rather than finding severity or an average", () => {
    const fixture = assessmentCalibrationFixtures[4];
    const result = assess(fixture.assessment, {
      evidenceLines: new Map([["README.md", new Map([[1, fixture.source]])]]),
      findings: [{ severity: "low" }, { severity: "low" }],
    });
    expect(result).toMatchObject({
      state: "complete",
      score: 5,
      readiness: { state: "ready_for_review" },
    });
  });
  test.each([0, 6, 2.5, "3"])("withholds malformed rating %s", (rating) => {
    const draft = assessmentCalibrationFixtures[0].assessment;
    expect(
      assess({
        ...draft,
        dimensions: {
          ...draft.dimensions,
          impact: { level: rating, reason: "Malformed" },
        },
      }),
    ).toMatchObject({
      state: "incomplete",
      missingEvidence: ["The assessment response could not be validated."],
      readiness: { state: "incomplete" },
    });
  });
  test("incomplete evidence has no numeric score while an ordinary gap can still be scored", () => {
    const incomplete = assess({
      state: "incomplete",
      missingEvidence: ["The changed binary cannot be inspected."],
    });
    expect(incomplete).toMatchObject({
      state: "incomplete",
      missingEvidence: ["The changed binary cannot be inspected."],
      readiness: { state: "incomplete" },
    });
    expect("score" in incomplete).toBe(false);
    const draft = assessmentCalibrationFixtures[0].assessment;
    const partial = assess(
      {
        ...draft,
        dimensions: {
          ...draft.dimensions,
          coverage: {
            level: 3,
            reason: "A related integration path needs inspection.",
          },
        },
      },
      { coverageReasons: ["An integration test was not executed."] },
    );
    expect(partial).toMatchObject({
      state: "complete",
      score: 3,
      coverageReasons: ["An integration test was not executed."],
    });
  });
  test("invented assessment evidence becomes incomplete without erasing findings", () => {
    const draft = assessmentCalibrationFixtures[0].assessment;
    expect(
      assess(
        {
          ...draft,
          evidence: [
            { path: "invented.ts", line: 1, quote: "fabricated evidence" },
          ],
        },
        { findings: [{ severity: "high" }] },
      ),
    ).toMatchObject({
      state: "incomplete",
      readiness: { state: "needs_attention" },
    });
  });
  test("unknown CI remains explicit without inventing readiness or suppressing scrutiny", () => {
    const result = assess(assessmentCalibrationFixtures[0].assessment, {
      signals: {
        ...signals,
        checks: {
          state: "unavailable",
          reason: "Checks permission is unavailable.",
          headSha: "head",
          observedAt: 115,
        },
      },
    });
    expect(result).toMatchObject({
      state: "complete",
      score: 1,
      readiness: { state: "incomplete" },
      signals: { checks: { state: "unavailable", observedAt: 115 } },
    });
    expect(result.readiness.reasons).toContain(
      "Checks permission is unavailable.",
    );
  });
  test.each(["failed", "pending"] as const)(
    "%s CI needs attention",
    (value) => {
      expect(
        assess(assessmentCalibrationFixtures[0].assessment, {
          signals: {
            ...signals,
            checks: { ...signals.checks, state: "known", value },
          },
        }),
      ).toMatchObject({ readiness: { state: "needs_attention" } });
    },
  );
  test("draft PRs need attention and legacy reviews have no fabricated score", () => {
    expect(
      assess(assessmentCalibrationFixtures[0].assessment, {
        signals: {
          ...signals,
          draft: { ...signals.draft, state: "known", value: true },
        },
      }),
    ).toMatchObject({ readiness: { state: "needs_attention" } });
    expect(readAssessment()).toEqual({
      state: "legacy",
      reason:
        "This saved review predates PR assessments. Review the latest commits to generate one.",
    });
  });
  test("rejects persisted scores inconsistent with dimensions and unpinned observations", () => {
    const valid = assess(assessmentCalibrationFixtures[0].assessment);
    expect(() =>
      persistedAssessmentSchema.parse({ ...valid, score: 2 }),
    ).toThrow("strongest dimension");
    expect(() =>
      persistedAssessmentSchema.parse({
        ...valid,
        signals: { ...signals, draft: { ...signals.draft, headSha: "other" } },
      }),
    ).toThrow("reviewed head");
  });
});
