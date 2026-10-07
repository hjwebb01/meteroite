import { expect, test } from "vitest";
import {
  changedLineRanges,
  buildHunks,
  savedHunks,
  validateChangeGroups,
  ungroupedHunks,
  containsChangedLine,
  fileCoverageGaps,
  validateHotspots,
} from "./review_navigation";
const patch = "@@ -1,2 +1,2 @@\n context\n-old\n+new";
const file = {
  filename: "new.ts",
  previous_filename: "old.ts",
  anchors: { LEFT: [2], RIGHT: [2] },
  leftBlobSha: "left-blob",
  headBlobSha: "head-blob",
};
const draft = {
  kind: "human_judgment",
  title: "Sensitive access",
  reason: "Human needs to confirm the policy.",
  references: [{ path: "new.ts", line: 2, side: "LEFT" }],
};
test("pins human judgment to the proven diff ancestor and old rename path without needing a bug", () => {
  const output = validateHotspots(
    [draft],
    [file],
    { headSha: "head", diffLeftSha: "merge-base" },
    "run",
  );
  expect(output.rejected).toBe(0);
  expect(output.hotspots[0].references[0]).toEqual({
    path: "new.ts",
    sourcePath: "old.ts",
    line: 2,
    side: "LEFT",
    commitSha: "merge-base",
    blobSha: "left-blob",
  });
});
test("withholds nonexistent, context, and unproven LEFT references", () => {
  expect(
    validateHotspots([draft], [file], { headSha: "head" }, "run").hotspots,
  ).toEqual([]);
  for (const reference of [
    { path: "absent.ts", line: 2, side: "RIGHT" },
    { path: "new.ts", line: 1, side: "RIGHT" },
  ])
    expect(
      validateHotspots(
        [{ ...draft, references: [reference] }],
        [file],
        { headSha: "head", diffLeftSha: "left" },
        "run",
      ).rejected,
    ).toBe(1);
});
test("saved changed-line manifest validates references even when the display patch is excluded", () => {
  const saved = {
    filename: "new.ts",
    status: "modified",
    changedLineRanges: changedLineRanges(patch),
  };
  expect(containsChangedLine(saved, "RIGHT", 2)).toBe(true);
  expect(containsChangedLine(saved, "RIGHT", 1)).toBe(false);
});
test("coverage distinguishes unavailable patches, model omissions and display exclusions", () => {
  const gaps = [
    { kind: "model_context_omitted" as const, reason: "Budget" },
    { kind: "display_size_excluded" as const, reason: "Size" },
  ];
  expect(
    fileCoverageGaps({
      filename: "large.ts",
      status: "modified",
      coverageGaps: gaps,
    }),
  ).toEqual(gaps);
  expect(
    fileCoverageGaps({ filename: "legacy.ts", status: "modified" })[0].reason,
  ).toContain("does not record why");
});

test("missing side blob provenance fails closed for newly generated hotspots", () => {
  expect(
    validateHotspots(
      [draft],
      [{ ...file, leftBlobSha: undefined }],
      { headSha: "head", diffLeftSha: "left" },
      "run",
    ).rejected,
  ).toBe(1);
  expect(
    validateHotspots(
      [{ ...draft, references: [{ path: "new.ts", line: 2, side: "RIGHT" }] }],
      [{ ...file, headBlobSha: undefined }],
      { headSha: "head" },
      "run",
    ).rejected,
  ).toBe(1);
});

test("canonical renamed hunk identities remain reachable regardless of group membership or model coverage", () => {
  const file = {
    filename: "renamed.ts",
    previousFilename: "before.ts",
    status: "renamed",
    omittedReason: "diff token budget",
    patch:
      "@@ -1 +1 @@ first\n-a\n+b\n@@ -20,2 +20,2 @@ second\n context\n-c\n+d",
  };
  const hunks = buildHunks(file, "head:base");
  expect(
    hunks.map((hunk) => [hunk.path, hunk.ordinal, hunk.rightStart]),
  ).toEqual([
    ["renamed.ts", 0, 1],
    ["renamed.ts", 1, 20],
  ]);
  expect(buildHunks(file, "head:base")).toEqual(hunks);
  const draft = {
    title: "Policy",
    purpose: "Changing access policy",
    hunkIds: [hunks[0].id],
  };
  const { groups, rejected } = validateChangeGroups(
    [
      draft,
      { ...draft, title: "Caller contract" },
      { ...draft, hunkIds: ["invented"] },
    ],
    hunks,
    "run",
  );
  expect(rejected).toBe(1);
  expect(groups[0].hunkIds).toEqual(groups[1].hunkIds);
  expect(ungroupedHunks(hunks, groups)).toEqual([hunks[1]]);
  expect(
    savedHunks(
      [
        { ...file, hunks },
        { filename: "other.ts", status: "modified", patch },
        { filename: "binary.png", status: "modified" },
      ],
      "legacy",
    ),
  ).toHaveLength(3);
});
test("old reviews derive every saved hunk and empty-side ranges keep their direction", () => {
  const inventory = savedHunks(
    [
      {
        filename: "removed.ts",
        status: "removed",
        patch: "@@ -1 +0,0 @@\n-old",
      },
      { filename: "added.ts", status: "added", patch: "@@ -0,0 +1 @@\n+new" },
    ],
    "legacy",
  );
  expect(inventory[0]).toMatchObject({
    leftStart: 1,
    leftLines: 1,
    rightStart: 0,
    rightLines: 0,
  });
  expect(inventory[1]).toMatchObject({
    leftStart: 0,
    leftLines: 0,
    rightStart: 1,
    rightLines: 1,
  });
  expect(ungroupedHunks(inventory, [])).toEqual(inventory);
});
