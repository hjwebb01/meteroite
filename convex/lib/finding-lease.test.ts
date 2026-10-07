/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "../schema";
import { DEFAULT_CODING_MODEL_ID } from "./coding_models";
import {
  assertNoActiveFindingWork,
  grantFindingLease,
  requeueFindingWork,
  requireFindingLease,
  revokeFindingLease,
} from "./finding_lease";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

const modules = import.meta.glob("../**/*.ts");
const check = {
  command: ["node", "--test"],
  status: "failed" as const,
  output: "prior",
  sourceSha: "head",
};

async function fixture() {
  const t = convexTest(schema, modules);
  const workId = await t.run(async (ctx) => {
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
    return ctx.db.insert("reviewFindingWork", {
      ownerId: "alice",
      reviewId,
      findingId: "finding",
      requestId: "request-123",
      kind: "discussion",
      model: DEFAULT_CODING_MODEL_ID,
      status: "queued",
      attempt: 0,
      body: "Check the caller.",
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
  });
  const load = (ctx: MutationCtx) =>
    ctx.db.get("reviewFindingWork", workId).then((w) => w!);
  const grant = (generation = 0) =>
    t.run(async (ctx) => grantFindingLease(ctx, await load(ctx), generation));
  const requireLease = (attempt: number) =>
    t.run((ctx) => requireFindingLease(ctx, workId, attempt));
  return { t, workId, load, grant, requireLease };
}

const lost = (reason: string) => ({ data: { reason } });

test("only the current dispatch is granted a lease, once", async () => {
  const { grant, requireLease } = await fixture();
  expect(await grant(1)).toBeNull();
  expect(await grant(0)).toBe(1);
  expect(await grant(0)).toBeNull();
  expect((await requireLease(1)).status).toBe("running");
});

test("a lease ends for a stale attempt and at its deadline", async () => {
  const { t, workId, grant, requireLease } = await fixture();
  const attempt = (await grant())!;
  await expect(requireLease(attempt - 1)).rejects.toMatchObject(
    lost("cancelled"),
  );
  await t.run((ctx) =>
    ctx.db.patch("reviewFindingWork", workId, { deadline: Date.now() }),
  );
  await expect(requireLease(attempt)).rejects.toMatchObject(lost("time-limit"));
});

test("revoking ends the attempt; a fenced revoke spares newer attempts", async () => {
  const { t, load, grant, requireLease } = await fixture();
  const attempt = (await grant())!;
  const revoke = (outcome: Parameters<typeof revokeFindingLease>[2]) =>
    t.run(async (ctx) => revokeFindingLease(ctx, await load(ctx), outcome));
  expect(
    await revoke({ status: "failed", attempt: attempt + 1, progress: "x" }),
  ).toBe(false);
  expect(
    await revoke({
      status: "failed",
      stopReason: "time-limit",
      error: "e".repeat(600),
      progress: "Time limit reached",
    }),
  ).toBe(true);
  await expect(requireLease(attempt)).rejects.toMatchObject(lost("time-limit"));
  const work = await t.run(load);
  expect(work.attempt).toBe(attempt + 1);
  expect(work.error).toHaveLength(500);
  expect(await revoke({ status: "cancelled", progress: "x" })).toBe(false);
});

test("requeueing archives the ended attempt under a new dispatch generation", async () => {
  const { t, workId, load, grant, requireLease } = await fixture();
  const first = (await grant())!;
  await t.run((ctx) =>
    ctx.db.patch("reviewFindingWork", workId, { checks: [check] }),
  );
  const requeue = () =>
    t.run(async (ctx) => requeueFindingWork(ctx, await load(ctx)));
  await expect(requeue()).rejects.toThrow("cannot be retried");
  await t.run(async (ctx) =>
    revokeFindingLease(ctx, await load(ctx), {
      status: "cancelled",
      stopReason: "cancelled",
      progress: "Cancelled",
    }),
  );
  expect(await requeue()).toEqual({ attempt: first + 2, generation: 1 });
  expect(await requeue()).toEqual({ attempt: first + 2, generation: 1 });
  const [work, archived] = await t.run(async (ctx) => [
    await load(ctx),
    await ctx.db.query("reviewFindingAttempts").collect(),
  ]);
  expect(work).toMatchObject({ status: "queued", checks: [] });
  expect(work.stopReason).toBeUndefined();
  expect(archived).toMatchObject([
    { attempt: first, status: "cancelled", checks: [check] },
  ]);
  expect(await grant(0)).toBeNull();
  const next = (await grant(1))!;
  expect((await requireLease(next)).checks).toEqual([]);
});

test("a finding has at most one active work", async () => {
  const { t, workId, load } = await fixture();
  const assertIdle = (except?: Id<"reviewFindingWork">) =>
    t.run(async (ctx) => {
      const work = await load(ctx);
      await assertNoActiveFindingWork(
        ctx,
        work.reviewId,
        work.findingId,
        "busy",
        except,
      );
    });
  await expect(assertIdle()).rejects.toThrow("busy");
  await assertIdle(workId);
});
