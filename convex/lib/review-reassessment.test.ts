import { expect, test } from "vitest";
import { compareReviewSnapshots } from "./review_reassessment";
import { buildHunks } from "./review_navigation";
const file = {
  filename: "auth.ts",
  status: "modified",
  patch: "@@ -1 +1 @@\n-old\n+new",
  headBlobSha: "auth-blob",
  leftBlobSha: "left-blob",
};
const hunks = buildHunks(file, "old-head:base");
const finding = {
  id: "f",
  path: "auth.ts",
  side: "RIGHT" as const,
  evidence: [
    { path: "caller.ts", commitSha: "old-head", blobSha: "caller-blob" },
  ],
};
const previous = {
  _id: "source",
  headSha: "old-head",
  baseSha: "base",
  diffLeftSha: "left",
  result: {
    findings: [finding],
    hotspots: [
      {
        id: "hot",
        kind: "human_judgment" as const,
        title: "Policy",
        reason: "Sensitive",
        references: [
          {
            path: "auth.ts",
            sourcePath: "auth.ts",
            side: "RIGHT" as const,
            line: 1,
            commitSha: "old-head",
            blobSha: "auth-blob",
          },
        ],
      },
    ],
    changeGroups: [
      {
        id: "group",
        title: "Access",
        purpose: "Access policy",
        hunkIds: [hunks[0].id],
      },
    ],
  },
};
const current = {
  headSha: "new-head",
  diffLeftSha: "left",
  files: [
    { filename: "auth.ts", headBlobSha: "auth-blob", leftBlobSha: "left-blob" },
  ],
  paths: [
    { path: "auth.ts", sha: "auth-blob" },
    { path: "caller.ts", sha: "caller-blob" },
  ],
  inventoryComplete: true,
};
function compare(
  overrides: Partial<Parameters<typeof compareReviewSnapshots>[0]> = {},
) {
  return compareReviewSnapshots({
    previous,
    previousFiles: [{ ...file, hunks }],
    current,
    findings: [],
    comparedAt: 10,
    ...overrides,
  });
}
test("unchanged supporting blobs carry explicit source provenance without claiming absent findings fixed", () => {
  const result = compare();
  expect(result).toMatchObject({
    sourceReviewId: "source",
    sourceHeadSha: "old-head",
    headSha: "new-head",
    absentFindingIds: ["f"],
  });
  expect(result.contexts.map((context) => context.state)).toEqual([
    "unchanged",
    "unchanged",
    "unchanged",
  ]);
  expect(result.contexts[0].reason).toContain("original snapshot");
});
test("changed related evidence renews the finding even when its anchor blob stayed unchanged", () => {
  const result = compare({
    current: {
      ...current,
      paths: [current.paths[0], { path: "caller.ts", sha: "changed-caller" }],
    },
  });
  expect(result.contexts[0].state).toBe("changed");
  expect(result.contexts[1].state).toBe("unchanged");
});
test("an exact rename carries unchanged blobs to the new path while changed content is renewed", () => {
  const renamed = {
    ...current,
    files: [
      {
        filename: "access.ts",
        previous_filename: "auth.ts",
        headBlobSha: "auth-blob",
        leftBlobSha: "left-blob",
      },
    ],
    paths: [{ path: "access.ts", sha: "auth-blob" }, current.paths[1]],
  };
  expect(compare({ current: renamed }).contexts[0]).toMatchObject({
    state: "unchanged",
    currentPaths: ["access.ts", "caller.ts"],
  });
  expect(
    compare({
      current: {
        ...renamed,
        paths: [{ path: "access.ts", sha: "different" }, current.paths[1]],
      },
    }).contexts[0].state,
  ).toBe("changed");
});
test("missing provenance and incomplete discovery stay ambiguous, and confirmed removal is changed", () => {
  expect(
    compare({ previousFiles: [{ ...file, headBlobSha: undefined }] })
      .contexts[0].state,
  ).toBe("ambiguous");
  expect(
    compare({
      current: {
        ...current,
        paths: [current.paths[0]],
        inventoryComplete: false,
      },
    }).contexts[0].state,
  ).toBe("ambiguous");
  expect(
    compare({ current: { ...current, paths: [current.paths[0]] } }).contexts[0]
      .state,
  ).toBe("changed");
  expect(
    compare({
      previous: {
        _id: "legacy",
        result: {
          findings: [{ ...finding, evidence: [{ path: "caller.ts" }] }],
        },
      },
      previousFiles: [],
    }).contexts[0].state,
  ).toBe("ambiguous");
});
test("partial old group manifests and unmatched LEFT ancestors cannot certify unchanged context", () => {
  expect(
    compare({
      previous: {
        ...previous,
        result: {
          ...previous.result,
          changeGroups: [
            {
              ...previous.result.changeGroups[0],
              hunkIds: [hunks[0].id, "missing"],
            },
          ],
        },
      },
    }).contexts[2].state,
  ).toBe("ambiguous");
  expect(
    compare({ current: { ...current, diffLeftSha: undefined, files: [] } })
      .contexts[2].state,
  ).toBe("ambiguous");
});

test("ambiguous path migrations require reassessment and saved current file blobs remain authoritative", () => {
  const migrated = {
    ...current,
    files: [
      {
        filename: "first.ts",
        previous_filename: "auth.ts",
        headBlobSha: "auth-blob",
      },
      {
        filename: "second.ts",
        previous_filename: "auth.ts",
        headBlobSha: "auth-blob",
      },
    ],
    paths: [current.paths[1]],
  };
  expect(compare({ current: migrated }).contexts[0].state).toBe("ambiguous");
  const incomplete = {
    ...current,
    paths: [current.paths[1]],
    inventoryComplete: false,
  };
  expect(compare({ current: incomplete }).contexts[0].state).toBe("unchanged");
});
