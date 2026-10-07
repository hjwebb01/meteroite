import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { verifyAuth } from "./auth";
import { proposalFields } from "./lib/review_proposal_fields";
import { getOwnedReview } from "./lib/owned_review";
export const list = query({
  args: { reviewId: v.id("reviews"), findingId: v.string() },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    await getOwnedReview(ctx, args.reviewId, identity.subject);
    return ctx.db
      .query("reviewProposals")
      .withIndex("by_finding", (q) =>
        q.eq("reviewId", args.reviewId).eq("findingId", args.findingId),
      )
      .order("desc")
      .take(10);
  },
});
export const save = internalMutation({
  args: proposalFields,
  handler: async (ctx, args) => {
    const work = await ctx.db.get("reviewFindingWork", args.workId);
    if (
      !work ||
      work.ownerId !== args.ownerId ||
      work.reviewId !== args.reviewId ||
      work.findingId !== args.findingId ||
      work.attempt !== args.attempt ||
      work.status !== "running" ||
      (work.deadline ?? 0) <= Date.now()
    )
      return null;
    if (
      work.kind !== "investigation" ||
      args.sourceSha !== work.headSha ||
      args.sourceOwner !== work.sourceOwner ||
      args.sourceRepo !== work.sourceRepo ||
      args.investigation.verdict !== "supported"
    )
      throw new Error("Invalid proposal provenance");
    const duplicate = await ctx.db
      .query("reviewProposals")
      .withIndex("by_work", (q) => q.eq("workId", args.workId))
      .unique();
    if (duplicate) {
      if (duplicate.digest !== args.digest)
        throw new Error("Proposal is immutable");
      return duplicate._id;
    }
    return ctx.db.insert("reviewProposals", args);
  },
});
