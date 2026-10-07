/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { DEFAULT_CODING_MODEL_ID } from "./lib/coding_models";
import {
  grantFindingLease,
  revokeFindingLease,
  requeueFindingWork,
} from "./lib/finding_lease";

const modules = import.meta.glob("./**/*.ts");
const conclusion = {
  verdict: "supported" as const,
  explanation: "The caller skips authorization.",
  evidence: [],
  assumptions: [],
};

test("each Attempt saves its own immutable Proposal", async () => {
  const t = convexTest(schema, modules);
  const { reviewId, workId } = await t.run(async (ctx) => {
    const reviewId = await ctx.db.insert("reviews", {
      ownerId: "alice",
      repoOwner: "upstream",
      repoName: "app",
      pullNumber: 7,
      url: "https://github.com/upstream/app/pull/7",
      status: "completed",
      model: DEFAULT_CODING_MODEL_ID,
      instructions: "",
      progress: "Complete",
      updatedAt: 0,
    });
    const workId = await ctx.db.insert("reviewFindingWork", {
      ownerId: "alice",
      reviewId,
      findingId: "finding",
      requestId: "request-123",
      kind: "investigation",
      model: DEFAULT_CODING_MODEL_ID,
      status: "queued",
      attempt: 0,
      body: "Investigate",
      headSha: "head",
      baseSha: "base",
      sourceOwner: "fork",
      sourceRepo: "app",
      maxDurationMs: 60_000,
      maxCostMicros: 1_000_000,
      reservedCostMicros: 0,
      createdAt: 0,
      updatedAt: 0,
      progress: "Waiting",
    });
    return { reviewId, workId };
  });
  const grant = (generation: number) =>
    t.run(async (ctx) =>
      grantFindingLease(
        ctx,
        (await ctx.db.get("reviewFindingWork", workId))!,
        generation,
      ),
    );
  const save = (attempt: number, digest: string) =>
    t.mutation(internal.reviewProposals.save, {
      ownerId: "alice",
      reviewId,
      findingId: "finding",
      workId,
      attempt,
      sourceSha: "head",
      sourceOwner: "fork",
      sourceRepo: "app",
      sourceBranch: "feature",
      digest,
      files: [],
      rationale: "Authorize first",
      investigation: conclusion,
      checks: [],
      createdAt: 0,
    });
  const first = (await grant(0))!;
  const firstId = await save(first, "one");
  expect(await save(first, "one")).toBe(firstId);
  await expect(save(first, "two")).rejects.toThrow("Proposal is immutable");
  await t.run(async (ctx) => {
    const work = (await ctx.db.get("reviewFindingWork", workId))!;
    await revokeFindingLease(ctx, work, {
      status: "cancelled",
      progress: "Cancelled",
    });
    await requeueFindingWork(
      ctx,
      (await ctx.db.get("reviewFindingWork", workId))!,
    );
  });
  const second = (await grant(1))!;
  const secondId = await save(second, "two");
  expect(secondId).not.toBe(firstId);
  const saved = await t.run((ctx) => ctx.db.query("reviewProposals").collect());
  expect(saved.map((p) => [p.attempt, p.digest])).toEqual([
    [first, "one"],
    [second, "two"],
  ]);
});
