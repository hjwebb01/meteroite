import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { verifyAuth } from "./auth";
import type { Doc } from "./_generated/dataModel";
import { getOwnedReview } from "./lib/owned_review";
import { assertCodingModelId } from "./lib/coding_models";
import { assertNoActiveFindingWork } from "./lib/active_finding_work";

export const thread = query({
  args: {
    reviewId: v.id("reviews"),
    findingId: v.string(),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, { reviewId, findingId, cursor }) => {
    const identity = await verifyAuth(ctx);
    const review = await ctx.db.get("reviews", reviewId);
    if (
      !review ||
      review.ownerId !== identity.subject ||
      !review.result?.findings.some((f) => f.id === findingId)
    )
      throw new Error("Finding not found");
    const messages = await ctx.db
      .query("reviewMessages")
      .withIndex("by_finding", (q) =>
        q.eq("reviewId", reviewId).eq("findingId", findingId),
      )
      .order("desc")
      .paginate({ numItems: 30, cursor: cursor ?? null });
    const work = await ctx.db
      .query("reviewFindingWork")
      .withIndex("by_finding", (q) =>
        q.eq("reviewId", reviewId).eq("findingId", findingId),
      )
      .order("desc")
      .take(30);
    const attempts = await ctx.db
      .query("reviewFindingAttempts")
      .withIndex("by_finding", (q) =>
        q.eq("reviewId", reviewId).eq("findingId", findingId),
      )
      .order("desc")
      .take(30);
    const enrichedMessages = await Promise.all(
      messages.page.reverse().map(async (message) => {
        const current = await ctx.db.get("reviewFindingWork", message.workId);
        const archived =
          message.attempt !== undefined && current?.attempt !== message.attempt
            ? await ctx.db
                .query("reviewFindingAttempts")
                .withIndex("by_work_attempt", (q) =>
                  q
                    .eq("workId", message.workId)
                    .eq("attempt", message.attempt!),
                )
                .unique()
            : null;
        return {
          ...message,
          recordedChecks: archived?.checks ?? current?.checks ?? [],
        };
      }),
    );
    return {
      messages: enrichedMessages,
      attempts,
      olderCursor: messages.isDone ? null : messages.continueCursor,
      work,
    };
  },
});

// The latest reconsidered verdict per finding, so a retraction stays visible
// wherever the original claim is shown.
export const verdicts = query({
  args: { reviewId: v.id("reviews") },
  handler: async (ctx, { reviewId }) => {
    const identity = await verifyAuth(ctx);
    const review = await getOwnedReview(ctx, reviewId, identity.subject);
    const latest: Record<
      string,
      NonNullable<Doc<"reviewMessages">["conclusion"]>["verdict"]
    > = {};
    for (const finding of review.result?.findings ?? []) {
      const message = await ctx.db
        .query("reviewMessages")
        .withIndex("by_finding", (q) =>
          q.eq("reviewId", reviewId).eq("findingId", finding.id),
        )
        .order("desc")
        .filter((q) => q.neq(q.field("conclusion"), undefined))
        .first();
      if (message?.conclusion) latest[finding.id] = message.conclusion.verdict;
    }
    return latest;
  },
});

export const discuss = mutation({
  args: {
    reviewId: v.id("reviews"),
    findingId: v.string(),
    requestId: v.string(),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    const review = await ctx.db.get("reviews", args.reviewId);
    if (
      !review ||
      review.ownerId !== identity.subject ||
      review.status !== "completed" ||
      !review.result?.findings.some((f) => f.id === args.findingId)
    )
      throw new Error("Finding not found");
    if (
      !args.body.trim() ||
      args.body.length > 4000 ||
      !/^[A-Za-z0-9_-]{8,100}$/.test(args.requestId)
    )
      throw new Error("Invalid discussion");
    const duplicate = await ctx.db
      .query("reviewFindingWork")
      .withIndex("by_owner_request", (q) =>
        q.eq("ownerId", identity.subject).eq("requestId", args.requestId),
      )
      .unique();
    if (duplicate) {
      if (
        duplicate.reviewId !== args.reviewId ||
        duplicate.findingId !== args.findingId ||
        duplicate.body !== args.body.trim()
      )
        throw new Error("Request identity already used");
      return {
        workId: duplicate._id,
        created: false,
        dispatch: duplicate.status === "queued",
      };
    }
    await assertNoActiveFindingWork(
      ctx,
      args.reviewId,
      args.findingId,
      "This finding already has active work. Cancel it or wait before replying.",
    );
    if (
      !review.headSha ||
      !review.baseSha ||
      !review.sourceOwner ||
      !review.sourceRepo
    )
      throw new Error(
        "This review has no pinned source. Run a new review first.",
      );
    assertCodingModelId(review.model);
    const now = Date.now();
    const workId = await ctx.db.insert("reviewFindingWork", {
      ...args,
      body: args.body.trim(),
      ownerId: identity.subject,
      kind: "discussion",
      model: review.model,
      status: "queued",
      attempt: 0,
      headSha: review.headSha,
      baseSha: review.baseSha,
      sourceOwner: review.sourceOwner,
      sourceRepo: review.sourceRepo,
      maxDurationMs: 300_000,
      maxCostMicros: 2_000_000,
      reservedCostMicros: 0,
      createdAt: now,
      updatedAt: now,
      progress: "Waiting for a response",
    });
    await ctx.db.insert("reviewMessages", {
      reviewId: args.reviewId,
      findingId: args.findingId,
      workId,
      role: "user",
      body: args.body.trim(),
      createdAt: now,
    });
    return { workId, created: true, dispatch: true };
  },
});

export const cancel = mutation({
  args: { workId: v.id("reviewFindingWork") },
  handler: async (ctx, { workId }) => {
    const identity = await verifyAuth(ctx);
    const work = await ctx.db.get("reviewFindingWork", workId);
    if (!work || work.ownerId !== identity.subject)
      throw new Error("Work not found");
    if (work.status === "queued" || work.status === "running")
      await ctx.db.patch("reviewFindingWork", workId, {
        status: "cancelled",
        stopReason: "cancelled",
        attempt: work.attempt + 1,
        updatedAt: Date.now(),
        progress: "Cancelled",
      });
    return {
      executionUnit: work.executionUnit ?? null,
      generation: work.dispatchGeneration ?? 0,
    };
  },
});

export const retry = mutation({
  args: { workId: v.id("reviewFindingWork") },
  handler: async (ctx, { workId }) => {
    const identity = await verifyAuth(ctx);
    const work = await ctx.db.get("reviewFindingWork", workId);
    if (!work || work.ownerId !== identity.subject)
      throw new Error("Work not found");
    if (work.status === "running" || work.status === "completed")
      throw new Error("Work cannot be retried");
    await assertNoActiveFindingWork(
      ctx,
      work.reviewId,
      work.findingId,
      "This finding already has active work",
      workId,
    );
    if (work.reservedCostMicros >= work.maxCostMicros)
      throw new Error(
        "The saved spending cap is exhausted. Start a new investigation with an explicit cap.",
      );
    const attempt = work.status === "queued" ? work.attempt : work.attempt + 1;
    const generation =
      work.status === "queued"
        ? (work.dispatchGeneration ?? 0)
        : (work.dispatchGeneration ?? 0) + 1;
    const evidenceAttempt = work.evidenceAttempt ?? work.attempt;
    if (work.status !== "queued") {
      const saved = await ctx.db
        .query("reviewFindingAttempts")
        .withIndex("by_work_attempt", (q) =>
          q.eq("workId", workId).eq("attempt", evidenceAttempt),
        )
        .unique();
      if (!saved)
        await ctx.db.insert("reviewFindingAttempts", {
          ownerId: work.ownerId,
          reviewId: work.reviewId,
          findingId: work.findingId,
          workId,
          attempt: evidenceAttempt,
          status: work.status,
          checks: work.checks ?? [],
          ...(work.result ? { result: work.result } : {}),
          ...(work.proposalError ? { proposalError: work.proposalError } : {}),
          ...(work.stopReason ? { stopReason: work.stopReason } : {}),
          ...(work.deadline ? { deadline: work.deadline } : {}),
          reservedCostMicros: work.reservedCostMicros,
          createdAt: Date.now(),
        });
    }
    await ctx.db.patch("reviewFindingWork", workId, {
      status: "queued",
      checks: [],
      evidenceAttempt: undefined,
      proposalError: undefined,
      attempt,
      dispatchGeneration: generation,
      deadline: undefined,
      error: undefined,
      stopReason: undefined,
      result: undefined,
      executionUnit: undefined,
      progress: "Waiting for dispatch",
      updatedAt: Date.now(),
    });
    return { workId, attempt, generation };
  },
});
