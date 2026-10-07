import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

// Another owner's review is reported as missing so its existence is not revealed.
export async function getOwnedReview(
  ctx: QueryCtx,
  reviewId: Id<"reviews">,
  ownerId: string,
) {
  const review = await ctx.db.get("reviews", reviewId);
  if (!review || review.ownerId !== ownerId)
    throw new Error("Review not found");
  return review;
}
