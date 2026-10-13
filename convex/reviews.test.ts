/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import type { PaginationResult } from "convex/server";
import type { ReviewHistoryRow } from "./reviews";
import { buildHunks } from "./lib/review_navigation";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { DEFAULT_CODING_MODEL_ID } from "./lib/coding_models";
import { createAssessment } from "./lib/review_assessment";
import { assessmentCalibrationFixtures } from "../src/features/reviews/lib/assessment-fixtures";

const modules = import.meta.glob("./**/*.ts");
const request = {
  repoOwner: "Alice",
  repoName: "App",
  pullNumber: 12,
  model: DEFAULT_CODING_MODEL_ID,
  instructions: "Focus on authorization",
};
const result = {
  summary: "Reviewed",
  findings: [],
  outdated: false,
  coverage: {
    changedFiles: 1,
    diffFiles: ["app.ts"],
    filesRead: ["app.ts"],
    warnings: [],
  },
};

describe("private PR reviews", () => {
  test.each(["openai/gpt-5.3-codex", "chatgpt:account-model"])(
    "persists the selected review provider and model: %s",
    async (model) => {
      const t = convexTest(schema, modules);
      const alice = t.withIdentity({ subject: "alice" });
      const { id } = await alice.mutation(api.reviews.start, {
        ...request,
        model,
      });
      expect(await alice.query(api.reviews.get, { id })).toMatchObject({
        model,
        ownerId: "alice",
        status: "queued",
      });
    },
  );
  test("requires authentication and isolates history and results by owner", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "alice" });
    const bob = t.withIdentity({ subject: "bob" });
    await expect(t.mutation(api.reviews.start, request)).rejects.toThrow(
      "Unauthorized",
    );
    const { id } = await alice.mutation(api.reviews.start, request);
    expect(await bob.query(api.reviews.list, {})).toEqual([]);
    await expect(bob.query(api.reviews.get, { id })).rejects.toThrow(
      "Review not found",
    );
    await expect(bob.mutation(api.reviews.cancel, { id })).rejects.toThrow(
      "Review not found",
    );
    await expect(bob.mutation(api.reviews.failToQueue, { id })).rejects.toThrow(
      "Review not found",
    );
    await expect(
      t.query(internal.reviewJobs.get, { id, ownerId: "bob" }),
    ).rejects.toThrow("Review not found");
    await expect(
      t.query(internal.reviewJobs.status, { id, ownerId: "bob" }),
    ).rejects.toThrow("Review not found");
    expect(
      await t.query(internal.reviewJobs.status, { id, ownerId: "alice" }),
    ).toBe("queued");
    for (const repoName of [".", ".."])
      await expect(
        alice.mutation(api.reviews.start, { ...request, repoName }),
      ).rejects.toThrow("Invalid review request");
    expect((await alice.query(api.reviews.get, { id })).instructions).toBe(
      request.instructions,
    );
  });

  test("saves each review's diff once per file and shows it only to the owner", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "alice" });
    const bob = t.withIdentity({ subject: "bob" });
    const { id } = await alice.mutation(api.reviews.start, request);
    await t.mutation(internal.reviewJobs.pinSnapshot, {
      id,
      title: "Pinned",
      headSha: "head",
      baseSha: "base",
      sourceOwner: "alice",
      sourceRepo: "app",
    });
    const file = {
      filename: "app.ts",
      status: "modified",
      patch: "@@ -1 +1 @@\n-a\n+b",
    };
    await t.mutation(internal.reviewJobs.saveFiles, {
      id,
      headSha: "head",
      baseSha: "base",
      files: [file],
    });
    await t.mutation(internal.reviewJobs.saveFiles, {
      id,
      headSha: "head",
      baseSha: "base",
      files: [{ ...file, omittedReason: "lockfile" }],
    });
    expect(await alice.query(api.reviews.files, { id })).toEqual([
      expect.objectContaining({ ...file, omittedReason: "lockfile" }),
    ]);
    await expect(bob.query(api.reviews.files, { id })).rejects.toThrow(
      "Review not found",
    );
  });

  test("deduplicates active reviews of the same canonical PR", async () => {
    const t = convexTest(schema, modules).withIdentity({ subject: "alice" });
    const first = await t.mutation(api.reviews.start, request);
    const second = await t.mutation(api.reviews.start, {
      ...request,
      repoOwner: "alice",
      repoName: "app",
    });
    expect(first.created).toBe(true);
    expect(second).toEqual({ id: first.id, created: false });
    expect((await t.query(api.reviews.get, { id: first.id })).url).toBe(
      "https://github.com/alice/app/pull/12",
    );
  });

  test("a cancelled review cannot be revived by late worker updates", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "alice" });
    const { id } = await alice.mutation(api.reviews.start, request);
    await alice.mutation(api.reviews.cancel, { id });
    expect(
      await t.mutation(internal.reviewJobs.progress, {
        id,
        progress: "Late progress",
      }),
    ).toBe(false);
    await t.mutation(internal.reviewJobs.finish, { id, result });
    await t.mutation(internal.reviewJobs.fail, { id, error: "Late failure" });
    const review = await alice.query(api.reviews.get, { id });
    expect(review.status).toBe("cancelled");
    expect(review.result).toBeUndefined();
  });

  test("repeat reviews keep the previous completed run and cannot overwrite it", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "alice" });
    const first = await alice.mutation(api.reviews.start, request);
    await t.mutation(internal.reviewJobs.finish, { id: first.id, result });
    await t.mutation(internal.reviewJobs.finish, {
      id: first.id,
      result: { ...result, summary: "Duplicate delivery" },
    });
    await alice.mutation(api.reviews.failToQueue, { id: first.id });
    expect(
      (await alice.query(api.reviews.get, { id: first.id })).result?.summary,
    ).toBe("Reviewed");
    const second = await alice.mutation(api.reviews.start, request);
    expect(second.id).not.toBe(first.id);
    expect(
      (await alice.query(api.reviews.get, { id: second.id })).previousReviewId,
    ).toBe(first.id);
  });

  test("rejects invalid PR identifiers, unsupported models, and oversized preferences", async () => {
    const t = convexTest(schema, modules).withIdentity({ subject: "alice" });
    for (const invalid of [
      { pullNumber: 0 },
      { pullNumber: 1.5 },
      { repoOwner: "alice/other" },
      { repoName: "../app" },
      { model: "arbitrary-model" },
      { instructions: "x".repeat(4001) },
    ]) {
      await expect(
        t.mutation(api.reviews.start, { ...request, ...invalid }),
      ).rejects.toThrow();
    }
  });
});

test("snapshot retries cannot replace pinned files or save after cancellation", async () => {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice" });
  const { id } = await alice.mutation(api.reviews.start, request);
  const pin = {
    id,
    title: "Pinned",
    headSha: "head",
    baseSha: "base",
    sourceOwner: "alice",
    sourceRepo: "app",
  };
  expect(await t.mutation(internal.reviewJobs.pinSnapshot, pin)).toBe(true);
  const file = {
    filename: "app.ts",
    status: "modified",
    patch: "@@ -1 +1 @@\n-a\n+b",
  };
  await t.mutation(internal.reviewJobs.saveFiles, {
    id,
    headSha: "head",
    baseSha: "base",
    files: [file],
  });
  expect(
    await t.mutation(internal.reviewJobs.pinSnapshot, {
      ...pin,
      headSha: "new-head",
    }),
  ).toBe(false);
  await expect(
    t.mutation(internal.reviewJobs.saveFiles, {
      id,
      headSha: "new-head",
      baseSha: "base",
      files: [{ ...file, patch: "wrong" }],
    }),
  ).rejects.toThrow("pinned review snapshot");
  await alice.mutation(api.reviews.cancel, { id });
  await t.mutation(internal.reviewJobs.saveFiles, {
    id,
    headSha: "head",
    baseSha: "base",
    files: [{ ...file, patch: "late" }],
  });
  const saved = await alice.query(api.reviews.get, { id });
  expect(saved.headSha).toBe("head");
  expect((await alice.query(api.reviews.files, { id }))[0].patch).toBe(
    "@@ -1 +1 @@\n-a\n+b",
  );
});

test("persists an optional assessment, rejects inconsistent scores, and retains legacy reviews", async () => {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice" });
  const { id } = await alice.mutation(api.reviews.start, request);
  await t.mutation(internal.reviewJobs.pinSnapshot, {
    id,
    title: "Pinned",
    headSha: "head",
    baseSha: "base",
    sourceOwner: "alice",
    sourceRepo: "app",
  });
  const fixture = assessmentCalibrationFixtures[0];
  const assessment = createAssessment({
    draft: fixture.assessment,
    headSha: "head",
    baseSha: "base",
    assessedAt: 200,
    signals: {
      draft: { state: "known", value: false, headSha: "head", observedAt: 100 },
      checks: {
        state: "known",
        value: "passed",
        headSha: "head",
        observedAt: 110,
      },
    },
    evidenceLines: new Map([["README.md", new Map([[1, fixture.source]])]]),
    findings: [],
    coverageReasons: [],
  });
  if (assessment.state !== "complete")
    throw new Error("Fixture assessment must be complete");
  await expect(
    t.mutation(internal.reviewJobs.finish, {
      id,
      result: {
        ...result,
        assessment: {
          ...assessment,
          score: 2,
        },
      },
    }),
  ).rejects.toThrow("strongest dimension");
  await expect(
    t.mutation(internal.reviewJobs.finish, {
      id,
      result: { ...result, assessment: { ...assessment, baseSha: "other" } },
    }),
  ).rejects.toThrow("pinned review snapshot");
  await t.mutation(internal.reviewJobs.finish, {
    id,
    result: { ...result, assessment },
  });
  expect(
    (await alice.query(api.reviews.get, { id })).result?.assessment,
  ).toMatchObject({
    state: "complete",
    score: 1,
    readiness: { state: "ready_for_review" },
  });
  const legacy = await alice.mutation(api.reviews.start, request);
  await t.mutation(internal.reviewJobs.finish, { id: legacy.id, result });
  expect(
    (await alice.query(api.reviews.get, { id: legacy.id })).result,
  ).toEqual(result);
});

test("hotspot writes enforce saved changed lines, commit and blob provenance", async () => {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice" });
  const { id } = await alice.mutation(api.reviews.start, request);
  await t.mutation(internal.reviewJobs.pinSnapshot, {
    id,
    title: "Pinned",
    headSha: "head",
    baseSha: "base-tip",
    baseTipSha: "base-tip",
    diffLeftSha: "merge-base",
    sourceOwner: "alice",
    sourceRepo: "app",
  });
  await t.mutation(internal.reviewJobs.saveFiles, {
    id,
    headSha: "head",
    baseSha: "base-tip",
    files: [
      {
        filename: "new.ts",
        previousFilename: "old.ts",
        status: "renamed",
        patch: "@@ -1 +1 @@\n-old\n+new",
        leftBlobSha: "left-blob",
        headBlobSha: "head-blob",
      },
    ],
  });
  const reference = {
    path: "new.ts",
    sourcePath: "old.ts",
    line: 1,
    side: "LEFT" as const,
    commitSha: "merge-base",
    blobSha: "left-blob",
  };
  const hotspot = {
    id: "h",
    kind: "human_judgment" as const,
    title: "Policy",
    reason: "Confirm changed policy",
    references: [reference],
  };
  for (const changes of [
    { commitSha: "base-tip" },
    { line: 99 },
    { sourcePath: "new.ts" },
    { blobSha: "wrong" },
    { blobSha: undefined },
  ]) {
    await expect(
      t.mutation(internal.reviewJobs.finish, {
        id,
        result: {
          ...result,
          hotspots: [
            { ...hotspot, references: [{ ...reference, ...changes }] },
          ],
        },
      }),
    ).rejects.toThrow("saved review snapshot");
  }
  await t.mutation(internal.reviewJobs.finish, {
    id,
    result: { ...result, hotspots: [hotspot] },
  });
  expect((await alice.query(api.reviews.get, { id })).result?.hotspots).toEqual(
    [hotspot],
  );
  await expect(
    t.withIdentity({ subject: "bob" }).query(api.reviews.files, { id }),
  ).rejects.toThrow("Review not found");
});

test("saved hunk manifests and group writes cannot invent snapshot references", async () => {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice" });
  const { id } = await alice.mutation(api.reviews.start, request);
  await t.mutation(internal.reviewJobs.pinSnapshot, {
    id,
    title: "Hunks",
    headSha: "head",
    baseSha: "base",
    sourceOwner: "alice",
    sourceRepo: "app",
  });
  const file = {
    filename: "app.ts",
    status: "modified",
    patch: "@@ -1 +1 @@\n-old\n+new",
  };
  await expect(
    t.mutation(internal.reviewJobs.saveFiles, {
      id,
      headSha: "head",
      baseSha: "base",
      files: [
        {
          ...file,
          hunks: [
            {
              id: "invented",
              path: "app.ts",
              ordinal: 0,
              leftStart: 1,
              leftLines: 1,
              rightStart: 1,
              rightLines: 1,
              heading: "",
            },
          ],
        },
      ],
    }),
  ).rejects.toThrow("pinned text patch");
  await t.mutation(internal.reviewJobs.saveFiles, {
    id,
    headSha: "head",
    baseSha: "base",
    files: [file],
  });
  await expect(
    t.mutation(internal.reviewJobs.finish, {
      id,
      result: {
        ...result,
        changeGroups: [
          {
            id: "g",
            title: "Purpose",
            purpose: "Description",
            hunkIds: ["invented"],
          },
        ],
      },
    }),
  ).rejects.toThrow("saved hunk inventory");
});

test("freshness observations cannot change saved identity, cross owners or regress to an older observation", async () => {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice" });
  const { id } = await alice.mutation(api.reviews.start, request);
  await t.mutation(internal.reviewJobs.pinSnapshot, {
    id,
    title: "Pinned",
    headSha: "head",
    baseSha: "base",
    sourceOwner: "alice",
    sourceRepo: "app",
  });
  const observation = {
    state: "current" as const,
    headSha: "updated",
    baseTipSha: "base",
    observedAt: 200,
    reason: "Live observation",
  };
  await expect(
    t.mutation(internal.reviewJobs.recordFreshness, {
      id,
      ownerId: "bob",
      observation,
    }),
  ).rejects.toThrow("Review not found");
  await t.mutation(internal.reviewJobs.recordFreshness, {
    id,
    ownerId: "alice",
    observation,
  });
  await t.mutation(internal.reviewJobs.recordFreshness, {
    id,
    ownerId: "alice",
    observation: { ...observation, headSha: "head", observedAt: 100 },
  });
  expect(await alice.query(api.reviews.get, { id })).toMatchObject({
    headSha: "head",
    baseSha: "base",
    freshness: { state: "outdated", headSha: "updated", observedAt: 200 },
  });
});

test("failed freshness lookups preserve known staleness until a successful observation", async () => {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice" });
  const { id } = await alice.mutation(api.reviews.start, request);
  await t.mutation(internal.reviewJobs.pinSnapshot, {
    id,
    title: "Pinned",
    headSha: "head",
    baseSha: "base",
    sourceOwner: "alice",
    sourceRepo: "app",
  });
  const record = (
    observation: Parameters<
      typeof t.mutation<typeof internal.reviewJobs.recordFreshness>
    >[1]["observation"],
  ) =>
    t.mutation(internal.reviewJobs.recordFreshness, {
      id,
      ownerId: "alice",
      observation,
    });
  await record({
    state: "current",
    headSha: "newer",
    baseTipSha: "base",
    observedAt: 100,
    reason: "Branch advanced",
  });
  await record({
    state: "unavailable",
    observedAt: 200,
    reason: "GitHub disconnected",
  });
  expect((await alice.query(api.reviews.get, { id })).freshness).toMatchObject({
    state: "outdated",
    headSha: "newer",
    observedAt: 100,
  });
  await record({
    state: "current",
    headSha: "head",
    baseTipSha: "base",
    observedAt: 300,
    reason: "Branch restored",
  });
  expect((await alice.query(api.reviews.get, { id })).freshness?.state).toBe(
    "current",
  );
  await record({
    state: "unavailable",
    observedAt: 400,
    reason: "GitHub disconnected",
  });
  expect((await alice.query(api.reviews.get, { id })).freshness?.state).toBe(
    "unavailable",
  );
});

test("reassessment persistence rejects another snapshot or invented prior context", async () => {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice" });
  const first = await alice.mutation(api.reviews.start, request);
  await t.mutation(internal.reviewJobs.pinSnapshot, {
    id: first.id,
    title: "Original",
    headSha: "first",
    baseSha: "base",
    sourceOwner: "alice",
    sourceRepo: "app",
  });
  await t.mutation(internal.reviewJobs.finish, { id: first.id, result });
  const second = await alice.mutation(api.reviews.start, request);
  await t.mutation(internal.reviewJobs.pinSnapshot, {
    id: second.id,
    title: "New",
    headSha: "second",
    baseSha: "base",
    sourceOwner: "alice",
    sourceRepo: "app",
  });
  const comparison = {
    sourceReviewId: first.id,
    sourceHeadSha: "first",
    sourceBaseSha: "base",
    headSha: "second",
    comparedAt: 100,
    contexts: [],
    absentFindingIds: [],
  };
  await expect(
    t.mutation(internal.reviewJobs.finish, {
      id: second.id,
      result: {
        ...result,
        reassessment: { ...comparison, headSha: "another" },
      },
    }),
  ).rejects.toThrow("pinned review lineage");
  await expect(
    t.mutation(internal.reviewJobs.finish, {
      id: second.id,
      result: {
        ...result,
        reassessment: {
          ...comparison,
          contexts: [
            {
              kind: "finding",
              sourceId: "invented",
              state: "unchanged",
              reason: "Unknown",
              currentPaths: [],
            },
          ],
        },
      },
    }),
  ).rejects.toThrow("owned source review");
  await t.mutation(internal.reviewJobs.finish, {
    id: second.id,
    result: { ...result, reassessment: comparison },
  });
  expect(
    (await alice.query(api.reviews.get, { id: second.id })).result?.reassessment
      ?.sourceReviewId,
  ).toBe(first.id);
});

async function sectionReadingFixture() {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice" });
  const bob = t.withIdentity({ subject: "bob" });
  const { id } = await alice.mutation(api.reviews.start, request);
  await t.mutation(internal.reviewJobs.pinSnapshot, {
    id,
    title: "Saved sections",
    headSha: "read-head",
    baseSha: "read-base",
    sourceOwner: "alice",
    sourceRepo: "app",
  });
  const file = {
    filename: "app.ts",
    status: "modified",
    patch: "@@ -1 +1 @@\n-a\n+b",
  };
  await t.mutation(internal.reviewJobs.saveFiles, {
    id,
    headSha: "read-head",
    baseSha: "read-base",
    files: [{ ...file, hunks: buildHunks(file, "read-head:read-base") }],
  });
  const files = await alice.query(api.reviews.files, { id });
  const group = {
    id: "saved-group",
    title: "Purpose",
    purpose: "Explain the change",
    hunkIds: [files[0].hunks![0].id],
  };
  await t.mutation(internal.reviewJobs.finish, {
    id,
    result: { ...result, changeGroups: [group] },
  });
  return { t, alice, bob, id, group };
}

test("section reading is owner-checked, explicit, idempotent, revision-scoped and undoable", async () => {
  const { t, alice, bob, id } = await sectionReadingFixture();
  const mark = { id, headSha: "read-head", groupId: "saved-group", read: true };
  expect(await alice.query(api.reviews.readSections, { id })).toEqual([]);
  await expect(t.query(api.reviews.readSections, { id })).rejects.toThrow(
    "Unauthorized",
  );
  await expect(bob.query(api.reviews.readSections, { id })).rejects.toThrow(
    "Review not found",
  );
  await expect(bob.mutation(api.reviews.setSectionRead, mark)).rejects.toThrow(
    "Review not found",
  );
  await expect(
    alice.mutation(api.reviews.setSectionRead, { ...mark, headSha: "other" }),
  ).rejects.toThrow("completed saved revision");
  await expect(
    alice.mutation(api.reviews.setSectionRead, {
      ...mark,
      groupId: "ungrouped",
    }),
  ).rejects.toThrow("Saved change section not found");
  await alice.mutation(api.reviews.setSectionRead, mark);
  await alice.mutation(api.reviews.setSectionRead, mark);
  expect(await alice.query(api.reviews.readSections, { id })).toEqual([
    "saved-group",
  ]);
  expect(
    await t.run((ctx) => ctx.db.query("reviewSectionReads").collect()),
  ).toHaveLength(1);
  await alice.mutation(api.reviews.setSectionRead, { ...mark, read: false });
  expect(await alice.query(api.reviews.readSections, { id })).toEqual([]);
  expect(
    await t.run((ctx) => ctx.db.query("reviewSectionReads").collect()),
  ).toHaveLength(0);
});

test("historical reading remains saved when freshness changes and never transfers to a new review", async () => {
  const { t, alice, id, group } = await sectionReadingFixture();
  await alice.mutation(api.reviews.setSectionRead, {
    id,
    headSha: "read-head",
    groupId: group.id,
    read: true,
  });
  await t.mutation(internal.reviewJobs.recordFreshness, {
    id,
    ownerId: "alice",
    observation: {
      state: "outdated",
      headSha: "new-head",
      baseTipSha: "read-base",
      observedAt: 10,
      reason: "Head changed",
    },
  });
  expect(await alice.query(api.reviews.readSections, { id })).toEqual([
    group.id,
  ]);
  const next = await alice.mutation(api.reviews.start, request);
  await expect(
    alice.mutation(api.reviews.setSectionRead, {
      id: next.id,
      headSha: "new-head",
      groupId: group.id,
      read: true,
    }),
  ).rejects.toThrow("completed saved revision");
  await t.mutation(internal.reviewJobs.pinSnapshot, {
    id: next.id,
    title: "New revision",
    headSha: "new-head",
    baseSha: "read-base",
    sourceOwner: "alice",
    sourceRepo: "app",
  });
  const nextFile = {
    filename: "app.ts",
    status: "modified",
    patch: "@@ -1 +1 @@\n-a\n+c",
  };
  await t.mutation(internal.reviewJobs.saveFiles, {
    id: next.id,
    headSha: "new-head",
    baseSha: "read-base",
    files: [{ ...nextFile, hunks: buildHunks(nextFile, "new-head:read-base") }],
  });
  const files = await alice.query(api.reviews.files, { id: next.id });
  await t.mutation(internal.reviewJobs.finish, {
    id: next.id,
    result: {
      ...result,
      changeGroups: [{ ...group, hunkIds: [files[0].hunks![0].id] }],
    },
  });
  expect(await alice.query(api.reviews.readSections, { id: next.id })).toEqual(
    [],
  );
  expect(await alice.query(api.reviews.readSections, { id })).toEqual([
    group.id,
  ]);
});

test("owner-isolated paginated history reaches all saved reviews with real human reading counts", async () => {
  const { t, alice, bob, id, group } = await sectionReadingFixture();
  await alice.mutation(api.reviews.setSectionRead, {
    id,
    headSha: "read-head",
    groupId: group.id,
    read: true,
  });
  await t.run(async (ctx) => {
    for (let index = 0; index < 60; index++)
      await ctx.db.insert("reviews", {
        ...request,
        ownerId: "alice",
        url: `https://github.com/alice/app/pull/${index + 20}`,
        pullNumber: index + 20,
        status: "queued",
        progress: "Waiting",
        updatedAt: 0,
      });
    await ctx.db.insert("reviews", {
      ...request,
      ownerId: "bob",
      url: "https://github.com/bob/app/pull/1",
      status: "queued",
      progress: "Waiting",
      updatedAt: 0,
    });
  });
  const rows: { _id: string; readCount: number; sectionCount: number }[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: PaginationResult<ReviewHistoryRow> = await alice.query(
      api.reviews.history,
      {
        paginationOpts: { numItems: 17, cursor },
      },
    );
    rows.push(...page.page);
    if (page.isDone) break;
    cursor = page.continueCursor;
  }
  expect(rows).toHaveLength(61);
  expect(new Set(rows.map((row) => row._id)).size).toBe(61);
  expect(rows.find((row) => row._id === id)).toMatchObject({
    readCount: 1,
    sectionCount: 1,
  });
  expect(await alice.query(api.reviews.list, {})).toHaveLength(50);
  expect(
    (
      await bob.query(api.reviews.history, {
        paginationOpts: { numItems: 17, cursor: null },
      })
    ).page,
  ).toHaveLength(1);
});
