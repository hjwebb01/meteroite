import { expect, test } from "vitest";
import {
  buildDiffItems,
  calculateMarginLayout,
  diffSideOf,
  navigationLocation,
  parseSavedDiffs,
  stackCards,
  toGitPatch,
  type ReviewFinding,
  type ReviewAnnotation,
} from "./review-diff";

const patch = "@@ -1,2 +1,2 @@\n context\n-old\n+new";

function marginFinding(id: string, path = "x.ts"): ReviewAnnotation {
  return {
    kind: "finding",
    finding: {
      id,
      path,
      line: 2,
      side: "RIGHT",
      severity: "high",
      title: "Removed guard",
      explanation: "Why",
      suggestion: "Fix",
      evidence: [],
      previousFindingId: null,
    },
  };
}

test("margin layout sorts measured anchors and counts unrendered entries outside the viewport", () => {
  const anchors = [
    { key: "finding:bottom", lineY: 301, height: 40 },
    { key: "finding:edge", lineY: 300, height: 40 },
    { key: "finding:visible", lineY: 0, height: 40 },
    { key: "finding:above", lineY: -20, height: 40 },
  ];
  const layout = calculateMarginLayout({
    anchors,
    height: 300,
    headers: [{ path: "x.ts", top: 100 }],
    entries: [
      "unrendered-above",
      "above",
      "visible",
      "edge",
      "bottom",
      "unrendered-below",
    ].map((id) => marginFinding(id)),
  });
  expect(layout.path).toBe("x.ts");
  expect([...layout.placements.keys()]).toEqual([
    "finding:above",
    "finding:visible",
    "finding:edge",
    "finding:bottom",
  ]);
  expect(layout.placements.get("finding:edge")).toEqual({
    top: 252,
    lineY: 300,
  });
  expect(layout.hint).toEqual({
    above: 2,
    aboveKey: "finding:above",
    below: 2,
    belowKey: "finding:bottom",
  });
  expect(anchors[0].key).toBe("finding:bottom");
});

test("margin hints split after the last rendered anchor when all anchors are above", () => {
  const layout = calculateMarginLayout({
    anchors: [{ key: "finding:second", lineY: -10, height: 40 }],
    height: 300,
    headers: [{ path: "x.ts", top: -10 }],
    entries: ["first", "second", "third"].map((id) => marginFinding(id)),
  });
  expect(layout.hint).toEqual({
    above: 2,
    aboveKey: "finding:second",
    below: 1,
    belowKey: "finding:third",
  });
});

test("unrendered margin entries use the last reached file header to split hints", () => {
  const entries = [marginFinding("first"), marginFinding("second", "y.ts")];
  const layout = calculateMarginLayout({
    anchors: [],
    height: 300,
    headers: [
      { path: "x.ts", top: -100 },
      { path: "y.ts", top: 40 },
      { path: "z.ts", top: 41 },
    ],
    entries,
  });
  expect(layout.path).toBe("y.ts");
  expect(layout.hint).toEqual({
    above: 1,
    aboveKey: "finding:first",
    below: 1,
    belowKey: "finding:second",
  });
  expect(
    calculateMarginLayout({
      anchors: [],
      height: 300,
      headers: [],
      entries: [],
    }),
  ).toEqual({
    placements: new Map(),
    path: null,
    hint: { above: 0, aboveKey: undefined, below: 0, belowKey: undefined },
  });
});

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

test("margin cards stack below overlapping cards, slide up at the bottom, and stay on screen", () => {
  // Overlap: the second card is pushed below the first card plus the gap.
  expect(
    stackCards(
      [
        { lineY: 100, height: 40 },
        { lineY: 110, height: 40 },
      ],
      500,
    ),
  ).toEqual([86, 134]);
  // Bottom: a card whose line is near the edge slides up to fit the viewport.
  expect(stackCards([{ lineY: 480, height: 40 }], 500)).toEqual([452]);
  // Below the viewport: the card keeps its unclamped position.
  expect(
    stackCards(
      [
        { lineY: 100, height: 40 },
        { lineY: 600, height: 40 },
      ],
      500,
    ),
  ).toEqual([86, 586]);
  // Top: a card never starts above the viewport.
  expect(stackCards([{ lineY: 5, height: 40 }], 500)).toEqual([0]);
});

test("a code reference is annotated on deletions only when it is a removed line", () => {
  expect(diffSideOf("LEFT")).toBe("deletions");
  expect(diffSideOf("RIGHT")).toBe("additions");
  expect(diffSideOf(undefined)).toBe("additions");
});
