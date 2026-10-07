import { assertCodingModelId } from "./lib/coding_models";
import { getOwnedReview } from "./lib/owned_review";
import { assertNoActiveFindingWork } from "./lib/active_finding_work";
import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import {
  workConclusion,
  workPrice,
  workCheck,
  workStopReason,
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
    if (
      !work ||
      work.ownerId !== ownerId ||
      work.status !== "queued" ||
      (work.dispatchGeneration ?? 0) !== (generation ?? 0)
    )
      return null;
    const attempt = work.attempt + 1;
    await ctx.db.patch("reviewFindingWork", workId, {
      status: "running",
      attempt,
      evidenceAttempt: attempt,
      deadline: Date.now() + work.maxDurationMs,
      progress: "Inspecting pinned source",
      updatedAt: Date.now(),
    });
    return attempt;
  },
});
export const progress = internalMutation({
  args: {
    workId: v.id("reviewFindingWork"),
    attempt: v.number(),
    progress: v.string(),
  },
  handler: async (ctx, { workId, attempt, progress }) => {
    const work = await ctx.db.get("reviewFindingWork", workId);
    if (
      !work ||
      work.status !== "running" ||
      work.attempt !== attempt ||
      (work.deadline ?? 0) <= Date.now()
    )
      return false;
    await ctx.db.patch("reviewFindingWork", workId, {
      progress,
      updatedAt: Date.now(),
    });
    return true;
  },
});
export const finish = internalMutation({
  args: {
    workId: v.id("reviewFindingWork"),
    attempt: v.number(),
    result: workConclusion,
  },
  handler: async (ctx, { workId, attempt, result }) => {
    const work = await ctx.db.get("reviewFindingWork", workId);
    if (
      !work ||
      work.status !== "running" ||
      work.attempt !== attempt ||
      (work.deadline ?? 0) <= Date.now()
    )
      return false;
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
    return true;
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
    if (
      !work ||
      !["queued", "running"].includes(work.status) ||
      (work.dispatchGeneration ?? 0) !== generation ||
      (attempt !== undefined && work.attempt !== attempt)
    )
      return;
    await ctx.db.patch("reviewFindingWork", workId, {
      status: "failed",
      error: error.slice(0, 500),
      ...(stopReason ? { stopReason } : {}),
      progress: "Response failed",
      updatedAt: Date.now(),
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
      throw new Error("Finding not found");
    if (
      !review.headSha ||
      !review.baseSha ||
      !review.sourceOwner ||
      !review.sourceRepo
    )
      throw new Error("Run a new review to capture source identity first.");
    if (
      !/^[A-Za-z0-9_-]{8,100}$/.test(args.requestId) ||
      args.maxDurationMs < 30_000 ||
      args.maxDurationMs > 300_000 ||
      args.maxCostMicros < 100_000 ||
      args.maxCostMicros > 10_000_000 ||
      ![args.maxDurationMs, args.maxCostMicros].every(Number.isSafeInteger)
    )
      throw new Error("Invalid investigation limits");
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
        throw new Error("Request identity already used");
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
    const work = await ctx.db.get("reviewFindingWork", workId);
    if (!work || work.status !== "running" || work.attempt !== attempt)
      throw new ConvexError({
        reason: "cancelled",
        message: "Finding work cancelled or superseded",
      });
    if ((work.deadline ?? 0) <= Date.now())
      throw new ConvexError({
        reason: "time-limit",
        message: "Finding work exceeded its deadline",
      });
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
    const work = await ctx.db.get("reviewFindingWork", workId);
    if (
      !work ||
      work.status !== "running" ||
      work.attempt !== attempt ||
      (work.deadline ?? 0) <= Date.now()
    )
      return false;
    if ((work.checks?.length ?? 0) >= 8) throw new Error("Check limit reached");
    await ctx.db.patch("reviewFindingWork", workId, {
      checks: [
        ...(work.checks ?? []),
        {
          ...check,
          output:
            check.output.slice(0, 8000) +
            (check.output.length > 8000
              ? "\nStored output clipped at 8,000 characters."
              : ""),
        },
      ],
      updatedAt: Date.now(),
    });
    return true;
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
          await ctx.db.patch("reviewFindingWork", row._id, {
            status: "failed",
            attempt: row.attempt + 1,
            stopReason: "time-limit",
            error:
              "Work exceeded its deadline or could not start. Retry with a new request.",
            progress: "Time limit reached",
            updatedAt: now,
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
    const work = await ctx.db.get("reviewFindingWork", workId);
    if (
      !work ||
      work.status !== "running" ||
      work.attempt !== attempt ||
      (work.deadline ?? 0) <= Date.now()
    )
      return false;
    if (!/^meteroite-review-[0-9a-f-]{36}\.service$/.test(unit))
      throw new Error("Invalid execution identity");
    await ctx.db.patch("reviewFindingWork", workId, { executionUnit: unit });
    return true;
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
    const work = await ctx.db.get("reviewFindingWork", workId);
    if (
      !work ||
      work.status !== "running" ||
      work.attempt !== attempt ||
      (work.deadline ?? 0) <= Date.now()
    )
      return false;
    await ctx.db.patch("reviewFindingWork", workId, {
      result,
      ...(proposalError ? { proposalError: proposalError.slice(0, 500) } : {}),
    });
    return true;
  },
});
