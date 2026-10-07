import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

// A finding runs at most one queued or running request at a time.
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
  if (
    recent.some(
      (w) =>
        w._id !== except && (w.status === "queued" || w.status === "running"),
    )
  )
    throw new Error(message);
}
