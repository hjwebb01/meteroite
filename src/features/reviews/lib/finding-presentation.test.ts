import { describe, expect, test } from "vitest";
import type { Doc } from "../../../../convex/_generated/dataModel";
import {
  findingAgentPrompt,
  isNitpick,
  sortFindings,
  type Finding,
} from "./finding-presentation";
import { validateFindings, type FindingDraft } from "./review";

const base: Finding = {
  id: "r:0",
  severity: "medium",
  title: "Missing authorization",
  path: "app.ts",
  line: 11,
  side: "RIGHT",
  explanation: "Anyone can call it.",
  suggestion: "Check the owner.",
  evidence: [{ path: "app.ts", line: 11, quote: "authorize();" }],
  previousFindingId: null,
};

describe("finding presentation", () => {
  test("orders by severity, then confidence, keeping unscored findings last", () => {
    const ordered = sortFindings([
      { ...base, id: "a", severity: "low", confidence: 5 },
      { ...base, id: "b", severity: "high" },
      { ...base, id: "c", severity: "high", confidence: 4 },
    ]);
    expect(ordered.map((f) => f.id)).toEqual(["c", "b", "a"]);
  });

  test("only low-severity remarks or guesses are nitpicks", () => {
    expect(isNitpick({ ...base, severity: "low", category: "test_gap" })).toBe(
      true,
    );
    expect(isNitpick({ ...base, severity: "low", confidence: 2 })).toBe(true);
    expect(isNitpick({ ...base, severity: "low" })).toBe(false);
    expect(
      isNitpick({ ...base, severity: "high", category: "maintainability" }),
    ).toBe(false);
  });

  test("agent prompt carries location, evidence and fix", () => {
    const prompt = findingAgentPrompt({ ...base, category: "security" }, {
      repoOwner: "a",
      repoName: "b",
      headSha: "abc123",
    } as Doc<"reviews">);
    expect(prompt).toContain("a/b at commit abc123");
    expect(prompt).toContain("app.ts:11");
    expect(prompt).toContain("- app.ts:11: authorize();");
    expect(prompt).toContain("Suggested fix: Check the owner.");
  });
});

describe("finding labels from the model", () => {
  const draft = {
    ...base,
    id: undefined,
    side: "RIGHT",
    evidence: [{ path: "app.ts", line: 11, quote: "authorize();" }],
  } as unknown as FindingDraft;
  const files = [
    {
      filename: "app.ts",
      status: "modified",
      anchors: { LEFT: [], RIGHT: [11] },
    },
  ];
  const evidence = new Map([["app.ts", new Map([[11, "  authorize();"]])]]);

  test("unknown labels drop the label, not the finding", () => {
    const { findings, rejected } = validateFindings(
      [{ ...draft, category: "vibes", confidence: 9 }],
      files,
      evidence,
      [],
      "r",
    );
    expect(rejected).toBe(0);
    expect(findings[0].category).toBeUndefined();
    expect(findings[0].confidence).toBeUndefined();
  });

  test("valid labels are kept and null means unlabelled", () => {
    const [kept, bare] = [
      { ...draft, category: "security", confidence: 4 },
      { ...draft, title: "Other", category: null, confidence: null },
    ].map((d) => validateFindings([d], files, evidence, [], "r").findings[0]);
    expect(kept).toMatchObject({ category: "security", confidence: 4 });
    expect(bare.category).toBeUndefined();
  });
});
