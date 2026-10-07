/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
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
