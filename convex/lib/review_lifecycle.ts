import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

type Review = Doc<"reviews">;

const ACTIVE_STATUSES = ["queued", "running"] as const;

export const isActiveReview = (status: Review["status"]) =>
  (ACTIVE_STATUSES as readonly Review["status"][]).includes(status);

export async function loadActiveReview(ctx: MutationCtx, id: Id<"reviews">) {
  const review = await ctx.db.get("reviews", id);
  return review && isActiveReview(review.status) ? review : null;
}

export async function completeReview(
  ctx: MutationCtx,
  review: Review,
  result: NonNullable<Review["result"]>,
) {
  await ctx.db.patch("reviews", review._id, {
    result,
    status: "completed",
    progress: "Review complete",
    updatedAt: Date.now(),
  });
}

export async function failReview(
  ctx: MutationCtx,
  review: Review,
  error: string,
  progress = "Review failed",
) {
  await ctx.db.patch("reviews", review._id, {
    status: "failed",
    error,
    progress,
    updatedAt: Date.now(),
  });
}

export async function cancelReview(ctx: MutationCtx, review: Review) {
  await ctx.db.patch("reviews", review._id, {
    status: "cancelled",
    progress: "Review cancelled",
    updatedAt: Date.now(),
  });
}
