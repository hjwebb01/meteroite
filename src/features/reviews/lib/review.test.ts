import { describe, expect, test } from "vitest";
import {
  changedLineAnchors,
  fileAtCommitUrl,
  parsePullRequestUrl,
  validateFindings,
  type FindingDraft,
} from "./review";

describe("PR input", () => {
  test("canonicalizes a PR URL and accepts GitHub's file view", () => {
    expect(
      parsePullRequestUrl(
        " https://github.com/Alice/App/pull/42/files#diff-test ",
      ),
    ).toEqual({
      repoOwner: "alice",
      repoName: "app",
      pullNumber: 42,
      url: "https://github.com/alice/app/pull/42",
    });
  });
  test.each([
    "https://evil.test/github.com/alice/app/pull/1",
    "https://github.com.evil.test/alice/app/pull/1",
    "http://github.com/alice/app/pull/1",
    "https://user:token@github.com/alice/app/pull/1",
    "https://github.com/alice/app/pull/0",
    "https://github.com/alice/app/pull/9007199254740992",
    "https://github.com/alice/app/issues/1",
    "https://github.com/alice/app/pull/1/other",
  ])("rejects %s", (url) => {
    expect(() => parsePullRequestUrl(url)).toThrow();
  });
});

const patch =
  "@@ -10,3 +10,4 @@\n context\n-oldValue();\n+newValue();\n+authorize();\n context\n@@ -30 +31 @@\n-previous();\n+current();\n\\ No newline at end of file";
const finding: FindingDraft = {
  title: "Missing authorization",
  severity: "high",
  path: "app.ts",
  line: 11,
  side: "RIGHT",
  explanation: "A precise trigger",
  suggestion: "A concrete fix",
  evidence: [{ path: "caller.ts", line: 5, quote: "return loadUser();" }],
  previousFindingId: "previous:1",
};

describe("source evidence validation", () => {
  test("anchors only changed lines and handles multiple hunks and removals", () => {
    expect([...changedLineAnchors(patch, "RIGHT").keys()]).toEqual([
      11, 12, 31,
    ]);
    expect([...changedLineAnchors(patch, "LEFT").keys()]).toEqual([11, 30]);
  });
  test("withholds invented anchors and fabricated quotes, and drops unknown previous links", () => {
    const evidence = new Map([
      ["caller.ts", new Map([[5, "  return loadUser();"]])],
    ]);
    const drafts = [
      finding,
      { ...finding, title: "Context line", line: 10 },
      {
        ...finding,
        title: "Invented quote",
        evidence: [
          { path: "caller.ts", line: 5, quote: "return adminUser();" },
        ],
      },
      {
        ...finding,
        title: "Unknown link",
        line: 12,
        previousFindingId: "invented",
      },
    ];
    const result = validateFindings(
      drafts,
      [{ filename: "app.ts", status: "modified", patch }],
      evidence,
      [{ id: "previous:1", path: "app.ts" }],
      "run",
    );
    expect(result.rejected).toBe(2);
    expect(result.findings.map((f) => f.previousFindingId)).toEqual([
      "previous:1",
      null,
    ]);
  });
  test("rejects findings for omitted diffs and duplicate findings", () => {
    const evidence = new Map([
      ["caller.ts", new Map([[5, "return loadUser();"]])],
    ]);
    expect(
      validateFindings(
        [finding],
        [{ filename: "app.ts", status: "modified" }],
        evidence,
        [],
        "run",
      ).findings,
    ).toEqual([]);
    expect(
      validateFindings(
        [finding, finding],
        [{ filename: "app.ts", status: "modified", patch }],
        evidence,
        [],
        "run",
      ).findings,
    ).toHaveLength(1);
  });
  test("rejects a finding that breaks a bound on its own and keeps at most 20", () => {
    const evidence = new Map([
      ["caller.ts", new Map([[5, "return loadUser();"]])],
    ]);
    const files = [{ filename: "app.ts", status: "modified", patch }];
    const output = validateFindings(
      [
        { ...finding, title: "x".repeat(181) },
        { ...finding, evidence: [] },
        ...Array.from({ length: 21 }, (_, i) => ({
          ...finding,
          title: `Finding ${i}`,
        })),
      ],
      files,
      evidence,
      [],
      "run",
    );
    expect(output.findings).toHaveLength(20);
    expect(output.findings[0].id).toBe("run:2");
    expect(output.rejected).toBe(3);
  });

  test("links a repeat finding across an explicit rename without weakening current source evidence", () => {
    const evidence = new Map([
      ["caller.ts", new Map([[5, "return loadUser();"]])],
    ]);
    const renamed = [
      {
        filename: "app.ts",
        previous_filename: "old-app.ts",
        status: "renamed",
        patch,
      },
    ];
    const output = validateFindings(
      [finding],
      renamed,
      evidence,
      [{ id: "previous:1", path: "old-app.ts" }],
      "current",
    );
    expect(output.findings[0].previousFindingId).toBe("previous:1");
    expect(
      validateFindings(
        [
          {
            ...finding,
            evidence: [
              { path: "caller.ts", line: 5, quote: "invented source quote" },
            ],
          },
        ],
        renamed,
        evidence,
        [{ id: "previous:1", path: "old-app.ts" }],
        "current",
      ).findings,
    ).toEqual([]);
  });
  test("escapes file paths in commit links", () => {
    expect(fileAtCommitUrl("alice", "app", "abc", "src/file #1.ts", 5)).toBe(
      "https://github.com/alice/app/blob/abc/src/file%20%231.ts#L5",
    );
  });
});
