import { v } from "convex/values";
import {
  mutation,
  query,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import {
  ACTIVE_APPLICATION_STATUSES,
  applicationAction,
} from "./lib/review_application";
import { applicationBlockReason } from "./lib/review_application_fields";
import { verifyAuth } from "./auth";
export const list = query({
  args: { proposalId: v.id("reviewProposals") },
  handler: async (ctx, { proposalId }) => {
    const identity = await verifyAuth(ctx);
    const proposal = await ctx.db.get("reviewProposals", proposalId);
    if (!proposal || proposal.ownerId !== identity.subject)
      throw new Error("Proposal not found");
    return ctx.db
      .query("reviewApplications")
      .withIndex("by_proposal", (q) => q.eq("proposalId", proposalId))
      .collect();
  },
});
export const apply = mutation({
  args: {
    proposalId: v.id("reviewProposals"),
    expectedDigest: v.string(),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    const proposal = await ctx.db.get("reviewProposals", args.proposalId);
    if (!proposal || proposal.ownerId !== identity.subject)
      throw new Error("Proposal not found");
    if (proposal.digest !== args.expectedDigest)
      throw new Error("Proposal changed. Inspect its saved diff first.");
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(args.requestId))
      throw new Error("Invalid request identity");
    const reused = await ctx.db
      .query("reviewApplications")
      .withIndex("by_owner_request", (q) =>
        q.eq("ownerId", identity.subject).eq("requestId", args.requestId),
      )
      .unique();
    if (reused && reused.proposalId !== proposal._id)
      throw new Error("Request identity already used");
    const existing = await ctx.db
      .query("reviewApplications")
      .withIndex("by_proposal", (q) => q.eq("proposalId", proposal._id))
      .unique();
    if (existing) {
      if (["applied", "wait"].includes(applicationAction(existing)))
        return {
          applicationId: existing._id,
          generation: existing.generation,
          dispatch: false,
        };
      if (applicationAction(existing) === "reassess")
        throw new Error(
          "This proposal requires a new assessment and investigation. Review the latest commits.",
        );
      const generation = existing.generation + 1;
      await ctx.db.patch("reviewApplications", existing._id, {
        status: "queued",
        generation,
        error: undefined,
        blockReason: undefined,
        updatedAt: Date.now(),
      });
      return { applicationId: existing._id, generation, dispatch: true };
    }
    const applicationId = await ctx.db.insert("reviewApplications", {
      ownerId: identity.subject,
      reviewId: proposal.reviewId,
      proposalId: proposal._id,
      requestId: args.requestId,
      proposalDigest: proposal.digest,
      expectedHeadSha: proposal.sourceSha,
      sourceOwner: proposal.sourceOwner,
      sourceRepo: proposal.sourceRepo,
      sourceBranch: proposal.sourceBranch,
      status: "queued",
      generation: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { applicationId, generation: 0, dispatch: true };
  },
});
export const get = internalQuery({
  args: { applicationId: v.id("reviewApplications"), ownerId: v.string() },
  handler: async (ctx, { applicationId, ownerId }) => {
    const application = await ctx.db.get("reviewApplications", applicationId);
    if (!application || application.ownerId !== ownerId)
      throw new Error("Application not found");
    const proposal = await ctx.db.get(
      "reviewProposals",
      application.proposalId,
    );
    const review = await ctx.db.get("reviews", application.reviewId);
    if (
      !proposal ||
      !review ||
      proposal.ownerId !== ownerId ||
      review.ownerId !== ownerId
    )
      throw new Error("Proposal not found");
    return { application, proposal, review };
  },
});
export const claim = internalMutation({
  args: {
    applicationId: v.id("reviewApplications"),
    ownerId: v.string(),
    generation: v.number(),
  },
  handler: async (ctx, { applicationId, ownerId, generation }) => {
    const row = await ctx.db.get("reviewApplications", applicationId);
    if (
      !row ||
      row.ownerId !== ownerId ||
      row.generation !== generation ||
      row.status !== "queued"
    )
      return false;
    await ctx.db.patch("reviewApplications", applicationId, {
      status: "running",
      deadline: Date.now() + 120000,
      updatedAt: Date.now(),
    });
    return true;
  },
});
export const writing = internalMutation({
  args: { applicationId: v.id("reviewApplications"), generation: v.number() },
  handler: async (ctx, { applicationId, generation }) => {
    const row = await ctx.db.get("reviewApplications", applicationId);
    if (
      !row ||
      row.status !== "running" ||
      row.generation !== generation ||
      (row.deadline ?? 0) <= Date.now()
    )
      return false;
    await ctx.db.patch("reviewApplications", applicationId, {
      status: "writing",
      remoteStartedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return true;
  },
});
export const finish = internalMutation({
  args: {
    applicationId: v.id("reviewApplications"),
    generation: v.number(),
    commitSha: v.string(),
    commitUrl: v.string(),
  },
  handler: async (ctx, { applicationId, generation, commitSha, commitUrl }) => {
    const row = await ctx.db.get("reviewApplications", applicationId);
    if (
      !row ||
      row.generation !== generation ||
      !["running", "writing"].includes(row.status)
    )
      return false;
    await ctx.db.patch("reviewApplications", applicationId, {
      status: "applied",
      commitSha,
      commitUrl,
      error: undefined,
      blockReason: undefined,
      updatedAt: Date.now(),
    });
    return true;
  },
});
export const fail = internalMutation({
  args: {
    applicationId: v.id("reviewApplications"),
    generation: v.number(),
    error: v.string(),
    blockReason: v.optional(applicationBlockReason),
  },
  handler: async (ctx, { applicationId, generation, error, blockReason }) => {
    const row = await ctx.db.get("reviewApplications", applicationId);
    if (!row || row.generation !== generation || row.status === "applied")
      return;
    await ctx.db.patch("reviewApplications", applicationId, {
      status: row.remoteStartedAt ? "uncertain" : "blocked",
      error: error.slice(0, 500),
      blockReason:
        blockReason ?? (row.remoteStartedAt ? "uncertain" : "transient"),
      updatedAt: Date.now(),
    });
  },
});
export const expire = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const status of ACTIVE_APPLICATION_STATUSES) {
      const rows = await ctx.db
        .query("reviewApplications")
        .withIndex("by_status_updated", (q) =>
          q
            .eq("status", status)
            .lt("updatedAt", Date.now() - (status === "writing" ? 0 : 120000)),
        )
        .take(100);
      for (const row of rows)
        if ((row.deadline ?? row.createdAt + 600000) <= Date.now())
          await ctx.db.patch("reviewApplications", row._id, {
            status: row.remoteStartedAt ? "uncertain" : "blocked",
            generation: row.generation + 1,
            blockReason: row.remoteStartedAt ? "uncertain" : "transient",
            error:
              "Application could not finish. Reconcile the saved intent before retrying.",
            updatedAt: Date.now(),
          });
    }
  },
});

export const dispatchFailed = mutation({
  args: { applicationId: v.id("reviewApplications"), generation: v.number() },
  handler: async (ctx, { applicationId, generation }) => {
    const identity = await verifyAuth(ctx);
    const row = await ctx.db.get("reviewApplications", applicationId);
    if (!row || row.ownerId !== identity.subject)
      throw new Error("Application not found");
    if (row.status !== "queued" || row.generation !== generation) return;
    await ctx.db.patch("reviewApplications", applicationId, {
      status: "blocked",
      blockReason: "transient",
      error: "The application could not be dispatched. Retry the saved intent.",
      updatedAt: Date.now(),
    });
  },
});
