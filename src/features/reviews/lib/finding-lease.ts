import type { Infer } from "convex/values";
import type { FunctionArgs } from "convex/server";
import type { getConvexAdminClient } from "@/lib/convex-client";
import { internal } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type {
  workCheck,
  workConclusion,
} from "../../../../convex/lib/review_work_fields";
import { findingStopMessage, findingStopReason } from "./finding-stop";

type Conclusion = Infer<typeof workConclusion>;
type Proposal = Omit<
  FunctionArgs<typeof internal.reviewProposals.save>,
  "workId" | "attempt"
>;

// The worker's side of one Attempt's Lease. Every write is refused with a
// ConvexError (reason "cancelled" or "time-limit") once the Lease has ended;
// pass whatever stopped the worker to `fail` to record the outcome.
export function findingLease(
  convex: ReturnType<typeof getConvexAdminClient>,
  {
    workId,
    attempt,
    generation,
  }: { workId: Id<"reviewFindingWork">; attempt: number; generation: number },
) {
  const jobs = internal.reviewFindingJobs;
  const lease = { workId, attempt };
  let stage = "Inspecting pinned source";
  return {
    // Confirms the Lease is still held, reporting the current stage.
    heartbeat: async (next?: string) => {
      if (next) stage = next;
      await convex.mutation(jobs.progress, { ...lease, progress: stage });
    },
    attachExecution: (unit: string) =>
      convex.mutation(jobs.attachExecution, { ...lease, unit }),
    reserve: (amount: number) =>
      convex.mutation(jobs.reserve, { ...lease, amount }),
    saveCheck: (check: Infer<typeof workCheck>) =>
      convex.mutation(jobs.saveCheck, { ...lease, check }),
    recordPremise: (result: Conclusion, proposalError?: string) =>
      convex.mutation(jobs.recordPremise, {
        ...lease,
        result,
        ...(proposalError ? { proposalError } : {}),
      }),
    saveProposal: (proposal: Proposal) =>
      convex.mutation(internal.reviewProposals.save, {
        ...proposal,
        ...lease,
      }),
    finish: (result: Conclusion) =>
      convex.mutation(jobs.finish, { ...lease, result }),
    // Fails this Attempt only; a newer Attempt or ended work is left alone.
    fail: (error: unknown, signal?: AbortSignal) => {
      const reason = findingStopReason(error, signal);
      const cause =
        signal?.aborted && findingStopReason(error) === "infrastructure"
          ? signal.reason
          : error;
      return convex.mutation(jobs.fail, {
        ...lease,
        generation,
        error: findingStopMessage(cause),
        stopReason: reason,
      });
    },
  };
}

export type FindingLease = ReturnType<typeof findingLease>;
