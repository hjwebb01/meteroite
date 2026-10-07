import { ConvexError, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { workStatus, workStopReason } from "./review_work_fields";

// A Lease lets one worker record progress and results for one Attempt of
// Finding work. Attempt numbers fence workers of earlier Attempts, and the
// Dispatch generation fences duplicate or stale dispatches before they claim.

type FindingWork = Doc<"reviewFindingWork">;
type WorkStatus = Infer<typeof workStatus>;

export const ACTIVE_WORK_STATUSES = ["queued", "running"] as const;
export const isActiveWork = (status: WorkStatus) =>
  (ACTIVE_WORK_STATUSES as readonly WorkStatus[]).includes(status);

export type LeaseLostReason = "cancelled" | "time-limit";
const LEASE_LOST_MESSAGES: Record<LeaseLostReason, string> = {
  cancelled: "Finding work cancelled or superseded",
  "time-limit": "Finding work exceeded its deadline",
};
const leaseLost = (reason: LeaseLostReason) =>
  new ConvexError({ reason, message: LEASE_LOST_MESSAGES[reason] });

// Starts the next Attempt when this dispatch is the current one. Returns the
// Attempt number, or null when another dispatch already claimed the work.
export async function grantFindingLease(
  ctx: MutationCtx,
  work: FindingWork,
  generation: number,
) {
  if (work.status !== "queued" || (work.dispatchGeneration ?? 0) !== generation)
    return null;
  const attempt = work.attempt + 1;
  await ctx.db.patch("reviewFindingWork", work._id, {
    status: "running",
    attempt,
    evidenceAttempt: attempt,
    deadline: Date.now() + work.maxDurationMs,
    progress: "Inspecting pinned source",
    updatedAt: Date.now(),
  });
  return attempt;
}

// Loads the work for a write under the Attempt's Lease. Throws a ConvexError
// with reason "cancelled" or "time-limit" when the Lease has ended, including
// after the deadline: no write is accepted once time is up.
export async function requireFindingLease(
  ctx: QueryCtx,
  workId: Id<"reviewFindingWork">,
  attempt: number,
) {
  const work = await ctx.db.get("reviewFindingWork", workId);
  if (!work || work.status !== "running" || work.attempt !== attempt)
    throw leaseLost(
      work?.stopReason === "time-limit" ? "time-limit" : "cancelled",
    );
  if ((work.deadline ?? 0) <= Date.now()) throw leaseLost("time-limit");
  return work;
}

// Ends active work and its current Attempt. When `attempt` is given, only that
// Attempt is ended, so a stopped worker cannot fail a newer Attempt. Returns
// whether the work was active.
export async function revokeFindingLease(
  ctx: MutationCtx,
  work: FindingWork,
  outcome: {
    status: "failed" | "cancelled";
    stopReason?: Infer<typeof workStopReason>;
    error?: string;
    progress: string;
    attempt?: number;
  },
) {
  if (
    !isActiveWork(work.status) ||
    (outcome.attempt !== undefined && work.attempt !== outcome.attempt)
  )
    return false;
  await ctx.db.patch("reviewFindingWork", work._id, {
    status: outcome.status,
    attempt: work.attempt + 1,
    ...(outcome.stopReason ? { stopReason: outcome.stopReason } : {}),
    ...(outcome.error ? { error: outcome.error.slice(0, 500) } : {}),
    progress: outcome.progress,
    updatedAt: Date.now(),
  });
  return true;
}

// Queues ended work for another Attempt under a new Dispatch generation,
// archiving the evidence of the Attempt it replaces. Work that is still queued
// keeps its generation so the pending dispatch remains valid.
export async function requeueFindingWork(ctx: MutationCtx, work: FindingWork) {
  if (work.status === "running" || work.status === "completed")
    throw new Error("Work cannot be retried");
  const queued = work.status === "queued";
  const attempt = queued ? work.attempt : work.attempt + 1;
  const generation = (work.dispatchGeneration ?? 0) + (queued ? 0 : 1);
  if (!queued) await archiveAttempt(ctx, work);
  await ctx.db.patch("reviewFindingWork", work._id, {
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
  return { attempt, generation };
}

async function archiveAttempt(ctx: MutationCtx, work: FindingWork) {
  const attempt = work.evidenceAttempt ?? work.attempt;
  const saved = await ctx.db
    .query("reviewFindingAttempts")
    .withIndex("by_work_attempt", (q) =>
      q.eq("workId", work._id).eq("attempt", attempt),
    )
    .unique();
  if (saved) return;
  await ctx.db.insert("reviewFindingAttempts", {
    ownerId: work.ownerId,
    reviewId: work.reviewId,
    findingId: work.findingId,
    workId: work._id,
    attempt,
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

// A Finding has at most one active Finding work at a time.
export async function assertNoActiveFindingWork(
  ctx: QueryCtx,
  reviewId: Id<"reviews">,
  findingId: string,
  message: string,
  except?: Id<"reviewFindingWork">,
) {
  const recent = await ctx.db
    .query("reviewFindingWork")
    .withIndex("by_finding", (q) =>
      q.eq("reviewId", reviewId).eq("findingId", findingId),
    )
    .order("desc")
    .take(100);
  if (recent.some((w) => w._id !== except && isActiveWork(w.status)))
    throw new Error(message);
}
