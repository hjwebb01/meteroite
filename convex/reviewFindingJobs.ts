import { assertCodingModelId } from "./lib/coding_models";
import { getOwnedReview } from "./lib/owned_review";
import {
  assertNoActiveFindingWork,
  grantFindingLease,
  requireFindingLease,
  revokeFindingLease,
} from "./lib/finding_lease";
import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import {
  workConclusion,
  workPrice,
  workCheck,
  workStopReason,
  clipCheckOutput,
} from "./lib/review_work_fields";

export const get = internalQuery({
  args: { workId: v.id("reviewFindingWork"), ownerId: v.string() },
  handler: async (ctx, { workId, ownerId }) => {
    const work = await ctx.db.get("reviewFindingWork", workId);
    if (!work || work.ownerId !== ownerId) throw new Error("Work not found");
    const review = await getOwnedReview(ctx, work.reviewId, ownerId);
    const finding = review.result?.findings.find(
      (f) => f.id === work.findingId,
    );
    if (!finding) throw new Error("Finding not found");
    const messages = await ctx.db
      .query("reviewMessages")
      .withIndex("by_finding", (q) =>
        q.eq("reviewId", work.reviewId).eq("findingId", work.findingId),
      )
      .order("desc")
      .take(12);
    return { work, review, finding, messages: messages.reverse() };
  },
});
export const claim = internalMutation({
  args: {
    workId: v.id("reviewFindingWork"),
    ownerId: v.string(),
    generation: v.optional(v.number()),
  },
  handler: async (ctx, { workId, ownerId, generation }) => {
    const work = await ctx.db.get("reviewFindingWork", workId);
    if (!work || work.ownerId !== ownerId) return null;
    return grantFindingLease(ctx, work, generation ?? 0);
  },
});
export const progress = internalMutation({
  args: {
    workId: v.id("reviewFindingWork"),
    attempt: v.number(),
    progress: v.string(),
  },
  handler: async (ctx, { workId, attempt, progress }) => {
    await requireFindingLease(ctx, workId, attempt);
    await ctx.db.patch("reviewFindingWork", workId, {
      progress,
      updatedAt: Date.now(),
    });
  },
});
export const finish = internalMutation({
  args: {
    workId: v.id("reviewFindingWork"),
    attempt: v.number(),
    result: workConclusion,
  },
  handler: async (ctx, { workId, attempt, result }) => {
    const work = await requireFindingLease(ctx, workId, attempt);
    await ctx.db.insert("reviewMessages", {
      reviewId: work.reviewId,
      findingId: work.findingId,
      workId,
      role: "assistant",
      attempt,
      body: result.explanation,
      conclusion: result,
      createdAt: Date.now(),
    });
    await ctx.db.patch("reviewFindingWork", workId, {
      status: "completed",
      result,
      progress: "Response complete",
      updatedAt: Date.now(),
    });
  },
});
export const fail = internalMutation({
  args: {
    workId: v.id("reviewFindingWork"),
    attempt: v.optional(v.number()),
    generation: v.number(),
    error: v.string(),
    stopReason: v.optional(workStopReason),
  },
  handler: async (ctx, { workId, attempt, generation, error, stopReason }) => {
    const work = await ctx.db.get("reviewFindingWork", workId);
    if (!work || (work.dispatchGeneration ?? 0) !== generation) return;
    await revokeFindingLease(ctx, work, {
      status: "failed",
      attempt,
      error,
      stopReason,
      progress: "Response failed",
    });
  },
});

export const investigate = internalMutation({
  args: {
    ownerId: v.string(),
    reviewId: v.id("reviews"),
    findingId: v.string(),
    requestId: v.string(),
    model: v.string(),
    maxDurationMs: v.number(),
    maxCostMicros: v.number(),
    price: workPrice,
  },
  handler: async (ctx, args) => {
    assertCodingModelId(args.model);
    const review = await ctx.db.get("reviews", args.reviewId);
    if (
      !review ||
      review.ownerId !== args.ownerId ||
      review.status !== "completed" ||
      !review.result?.findings.some((f) => f.id === args.findingId)
    )
      throw new ConvexError("Finding not found");
    if (
      !review.headSha ||
      !review.baseSha ||
      !review.sourceOwner ||
      !review.sourceRepo
    )
      throw new ConvexError(
        "Run a new review to capture source identity first.",
      );
    if (
      !/^[A-Za-z0-9_-]{8,100}$/.test(args.requestId) ||
      args.maxDurationMs < 30_000 ||
      args.maxDurationMs > 300_000 ||
      args.maxCostMicros < 100_000 ||
      args.maxCostMicros > 10_000_000 ||
      ![args.maxDurationMs, args.maxCostMicros].every(Number.isSafeInteger)
    )
      throw new ConvexError("Invalid investigation limits");
    const duplicate = await ctx.db
      .query("reviewFindingWork")
      .withIndex("by_owner_request", (q) =>
        q.eq("ownerId", args.ownerId).eq("requestId", args.requestId),
      )
      .unique();
    if (duplicate) {
      if (
        duplicate.kind !== "investigation" ||
        duplicate.reviewId !== args.reviewId ||
        duplicate.findingId !== args.findingId ||
        duplicate.model !== args.model ||
        duplicate.maxCostMicros !== args.maxCostMicros ||
        duplicate.maxDurationMs !== args.maxDurationMs
      )
        throw new ConvexError("Request identity already used");
      return { workId: duplicate._id, dispatch: duplicate.status === "queued" };
    }
    await assertNoActiveFindingWork(
      ctx,
      args.reviewId,
      args.findingId,
      "This finding already has active work. Cancel it or wait.",
    );
    const now = Date.now();
    const workId = await ctx.db.insert("reviewFindingWork", {
      ...args,
      kind: "investigation",
      body: "Investigate the premise and propose a fix only when supported.",
      status: "queued",
      attempt: 0,
      headSha: review.headSha,
      baseSha: review.baseSha,
      sourceOwner: review.sourceOwner,
      sourceRepo: review.sourceRepo,
      reservedCostMicros: 0,
      createdAt: now,
      updatedAt: now,
      progress: "Waiting for isolated investigation",
      checks: [],
    });
    return { workId, dispatch: true };
  },
});
export const reserve = internalMutation({
  args: {
    workId: v.id("reviewFindingWork"),
    attempt: v.number(),
    amount: v.number(),
  },
  handler: async (ctx, { workId, attempt, amount }) => {
    const work = await requireFindingLease(ctx, workId, attempt);
    if (
      !Number.isSafeInteger(amount) ||
      amount < 0 ||
      work.reservedCostMicros + amount > work.maxCostMicros
    )
      throw new ConvexError({
        reason: "cost-limit",
        message:
          "Investigation cost cap reached. Start new work to authorize further spending.",
      });
    await ctx.db.patch("reviewFindingWork", workId, {
      reservedCostMicros: work.reservedCostMicros + amount,
      updatedAt: Date.now(),
    });
  },
});
export const saveCheck = internalMutation({
  args: {
    workId: v.id("reviewFindingWork"),
    attempt: v.number(),
    check: workCheck,
  },
  handler: async (ctx, { workId, attempt, check }) => {
    const work = await requireFindingLease(ctx, workId, attempt);
    if ((work.checks?.length ?? 0) >= 8) throw new Error("Check limit reached");
    await ctx.db.patch("reviewFindingWork", workId, {
      checks: [
        ...(work.checks ?? []),
        { ...check, output: clipCheckOutput(check.output) },
      ],
      updatedAt: Date.now(),
    });
  },
});
const QUEUED_WORK_TTL_MS = 10 * 60_000;

export const expire = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    // Queued work has no deadline yet (retry clears it), so it expires when it
    // has waited too long since it was last queued.
    const stale = {
      queued: now - QUEUED_WORK_TTL_MS,
      running: now - 60_000,
    } as const;
    for (const status of ["queued", "running"] as const) {
      const rows = await ctx.db
        .query("reviewFindingWork")
        .withIndex("by_status_updated", (q) =>
          q.eq("status", status).lt("updatedAt", stale[status]),
        )
        .take(100);
      for (const row of rows)
        if (status === "queued" || (row.deadline ?? 0) <= now)
          await revokeFindingLease(ctx, row, {
            status: "failed",
            stopReason: "time-limit",
            error:
              "Work exceeded its deadline or could not start. Retry with a new request.",
            progress: "Time limit reached",
          });
    }
  },
});

export const attachExecution = internalMutation({
  args: {
    workId: v.id("reviewFindingWork"),
    attempt: v.number(),
    unit: v.string(),
  },
  handler: async (ctx, { workId, attempt, unit }) => {
    await requireFindingLease(ctx, workId, attempt);
    if (!/^meteroite-review-[0-9a-f-]{36}\.service$/.test(unit))
      throw new Error("Invalid execution identity");
    await ctx.db.patch("reviewFindingWork", workId, { executionUnit: unit });
  },
});

export const recordPremise = internalMutation({
  args: {
    workId: v.id("reviewFindingWork"),
    attempt: v.number(),
    result: workConclusion,
    proposalError: v.optional(v.string()),
  },
  handler: async (ctx, { workId, attempt, result, proposalError }) => {
    await requireFindingLease(ctx, workId, attempt);
    await ctx.db.patch("reviewFindingWork", workId, {
      result,
      ...(proposalError ? { proposalError: proposalError.slice(0, 500) } : {}),
    });
  },
});
