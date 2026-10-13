import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export async function latestVerdicts(ctx: QueryCtx, review: Doc<"reviews">) {
  const verdicts: Record<
    string,
    NonNullable<Doc<"reviewMessages">["conclusion"]>["verdict"]
  > = {};
  for (const finding of review.result?.findings ?? []) {
    const message = await ctx.db
      .query("reviewMessages")
      .withIndex("by_finding", (q) =>
        q.eq("reviewId", review._id).eq("findingId", finding.id),
      )
      .order("desc")
      .filter((q) => q.neq(q.field("conclusion"), undefined))
      .first();
    if (message?.conclusion) verdicts[finding.id] = message.conclusion.verdict;
  }
  return verdicts;
}
