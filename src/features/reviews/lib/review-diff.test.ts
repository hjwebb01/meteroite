import { expect, test } from "vitest";
import {
  buildDiffItems,
  navigationLocation,
  parseSavedDiffs,
  toGitPatch,
  type ReviewFinding,
} from "./review-diff";

const patch = "@@ -1,2 +1,2 @@\n context\n-old\n+new";

test("adds git headers so added, removed, and renamed GitHub patches keep their type", () => {
  const parsed = parseSavedDiffs([
    { filename: "a.ts", status: "added", patch: "@@ -0,0 +1 @@\n+a" },
    { filename: "b.ts", status: "removed", patch: "@@ -1 +0,0 @@\n-b" },
    {
      filename: "c.ts",
      previousFilename: "old/c.ts",
      status: "renamed",
      patch,
    },
    { filename: "d.ts", status: "modified", patch },
    { filename: "e.png", status: "modified" },
  ]);
  expect(
    parsed.map(({ path, fileDiff }) => [
      path,
      fileDiff.type,
      fileDiff.prevName,
    ]),
  ).toEqual([
    ["a.ts", "new", undefined],
    ["b.ts", "deleted", undefined],
    ["c.ts", "rename-changed", "old/c.ts"],
    ["d.ts", "change", undefined],
  ]);
  expect(toGitPatch({ filename: "d.ts", status: "modified", patch })).toBe(
    `diff --git a/d.ts b/d.ts\n--- a/d.ts\n+++ b/d.ts\n${patch}`,
  );
});

test("anchors findings on their side and collapses files without findings unless toggled", () => {
  const diffs = parseSavedDiffs([
    { filename: "x.ts", status: "modified", patch },
    { filename: "y.ts", status: "modified", patch },
    { filename: "z.ts", status: "modified", patch },
  ]);
  const finding: ReviewFinding = {
    id: "f1",
    severity: "high",
    title: "Removed guard",
    path: "x.ts",
    line: 2,
    side: "LEFT",
    explanation: "Why",
    suggestion: "Fix",
    evidence: [],
    previousFindingId: null,
  };
  const items = buildDiffItems(diffs, [finding], new Set(["z.ts"]));
  const toggledFinding = buildDiffItems(diffs, [finding], new Set(["x.ts"]));
  expect(toggledFinding[0]).toMatchObject({ collapsed: true });
  expect(toggledFinding[0].version).not.toBe(items[0].version);
  expect(toggledFinding[1].version).toBe(items[1].version);
  expect(items[0]).toMatchObject({
    id: "diff:x.ts",
    collapsed: false,
    annotations: [
      {
        side: "deletions",
        lineNumber: 2,
        metadata: { kind: "finding", finding },
      },
    ],
  });
  expect(items[1]).toMatchObject({ collapsed: true, annotations: [] });
  expect(items[2]).toMatchObject({ collapsed: false });
});

test("hotspots annotate sensitive code independently of finding filters and focus opens collapsed files", () => {
  const diffs = parseSavedDiffs([
    { filename: "x.ts", status: "modified", patch },
    { filename: "y.ts", status: "modified", patch },
  ]);
  const hotspot = {
    id: "h1",
    kind: "human_judgment" as const,
    title: "Policy",
    reason: "Needs policy decision",
    references: [
      {
        path: "x.ts",
        sourcePath: "x.ts",
        line: 2,
        side: "RIGHT" as const,
        commitSha: "head",
      },
    ],
  };
  const items = buildDiffItems(diffs, [], new Set(), [hotspot], "y.ts");
  expect(items[0].annotations?.[0]).toMatchObject({
    side: "additions",
    lineNumber: 2,
    metadata: { kind: "hotspot", hotspot },
  });
  expect(items[0].collapsed).toBe(false);
  expect(items[1].collapsed).toBe(false);
});

test("file and hunk navigation keep diff direction independent of finding filters", () => {
  const hunk = {
    id: "h",
    path: "removed.ts",
    ordinal: 0,
    leftStart: 8,
    leftLines: 1,
    rightStart: 0,
    rightLines: 0,
    heading: "",
  };
  expect(navigationLocation({ kind: "file", path: "no-finding.ts" })).toEqual({
    path: "no-finding.ts",
  });
  expect(navigationLocation({ kind: "hunk", hunk })).toEqual({
    path: "removed.ts",
    line: 8,
    side: "LEFT",
  });
  expect(
    navigationLocation({
      kind: "group",
      hunk,
      group: {
        id: "g",
        title: "Purpose",
        purpose: "Cross-file purpose",
        hunkIds: ["h"],
      },
    }),
  ).toEqual({ path: "removed.ts", line: 8, side: "LEFT" });
});
