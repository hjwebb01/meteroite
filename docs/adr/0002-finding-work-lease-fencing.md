# Durable finding work is fenced by Attempt and Lease

Finding work is durable and can be retried, cancelled, or dispatched twice. Every write is fenced by the Attempt's Lease and the deadline, so a stopped or stale worker never overwrites a newer Attempt, and work that ends always records a truthful terminal state. These rules were code comments.

## Decisions

- `convex/lib/finding_lease.ts`: A Lease lets one worker record progress and results for one Attempt of Finding work. Attempt numbers fence workers of earlier Attempts, and the Dispatch generation fences duplicate or stale dispatches before they claim.
- `convex/lib/finding_lease.ts` (`export async function grantFindingLease(`): Starts the next Attempt when this dispatch is the current one. Returns the Attempt number, or null when another dispatch already claimed the work.
- `convex/lib/finding_lease.ts` (`export async function requireFindingLease(`): Loads the work for a write under the Attempt's Lease. Throws a ConvexError with reason "cancelled" or "time-limit" when the Lease has ended, including after the deadline: no write is accepted once time is up.
- `convex/lib/finding_lease.ts` (`export async function revokeFindingLease(`): Ends active work and its current Attempt. When `attempt` is given, only that Attempt is ended, so a stopped worker cannot fail a newer Attempt. Returns whether the work was active.
- `convex/lib/finding_lease.ts` (`export async function requeueFindingWork(ctx: MutationCtx, work: Findi`): Queues ended work for another Attempt under a new Dispatch generation, archiving the evidence of the Attempt it replaces. Work that is still queued keeps its generation so the pending dispatch remains valid.
- `convex/reviewFindingJobs.ts` (`const stale = {`): Queued work has no deadline yet (retry clears it), so it expires when it has waited too long since it was last queued.
- `convex/reviewJobs.ts` (`export const saveFiles = internalMutation({`): Upserts by filename so a retried load step does not duplicate files.
- `src/app/api/reviews/cancel/route.ts` (`try {`): Cancellation is already saved; a missed event cannot revive the run.
- `src/features/reviews/inngest/review-finding-work.ts` (`const reason = findingStopReason(error);`): A transient transport failure is not an ended Lease. The next synchronous heartbeat still guards every saved result.
- `src/features/reviews/inngest/review-finding-work.ts` (`async function openExecution(`): Without a usable runner the investigation continues as static inspection, and the limitation is recorded where checks would appear.
- `src/features/reviews/lib/check-execution.ts` (`type ExecutionAdapter = {`): Internal seam: the isolated runtime and controlled tests supply these operations.
- `src/features/reviews/lib/check-execution.ts` (`export function createCheckExecution(adapter: ExecutionAdapter) {`): Command outcomes only validate source that still matches the pinned snapshot or Proposal.
- `src/features/reviews/lib/check-execution.ts` (`await heartbeat();`): A runner failure must not hide cancellation or expiry of this Attempt.
- `src/features/reviews/lib/check-execution.ts` (`if (findingStopReason(error, signal) !== "infrastructure") throw error`): An ended Lease must stop the work, rather than become an unavailable Check.
- `src/features/reviews/lib/execution-provider.test.ts` (`const hostNamespace = await readlink("/proc/self/ns/pid");`): Namespace inode numbers may be reused after a command exits.
- `src/features/reviews/lib/execution-provider.ts` (`export async function executionCapability(): Promise<ExecutionCapabili`): Probing starts a systemd unit, so share one result across requests.
- `src/features/reviews/lib/finding-budget.ts` (`export async function currentFindingPrice(`): Queued or retried work can outlive the quote taken when it was requested.
- `src/features/reviews/lib/finding-lease.ts` (`export function findingLease(`): The worker's side of one Attempt's Lease. Every write is refused with a ConvexError (reason "cancelled" or "time-limit") once the Lease has ended; pass whatever stopped the worker to `fail` to record the outcome.
- `src/features/reviews/lib/finding-lease.ts` (`fail: (error: unknown, signal?: AbortSignal) => {`): Fails this Attempt only; a newer Attempt or ended work is left alone.
