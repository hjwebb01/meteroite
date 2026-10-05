import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { mutation, MutationCtx, query } from "./_generated/server";
import { getOwnedProject, verifyAuth } from "./auth";
import { assertCodingModelId, resolveCodingModelId } from "./lib/coding_models";

const cancelProcessingMessagesInProject = async (
  ctx: MutationCtx,
  projectId: Id<"projects">,
) => {
  const processing = await ctx.db
    .query("messages")
    .withIndex("by_project_status", (q) =>
      q.eq("projectId", projectId).eq("status", "processing"),
    )
    .collect();
  for (const message of processing) {
    await ctx.db.patch("messages", message._id, {
      status: "cancelled",
      progressLabel: undefined,
      progressSteps: undefined,
    });
  }
  return processing.map((message) => message._id);
};

/**
 * Cancels any running assistant turn in the project and creates the next
 * user/assistant message pair in one transaction, so concurrent submissions
 * cannot both end up processing. A `model` argument becomes the conversation's
 * model; the resolved model for this turn is returned for the worker event.
 */
export const startMessage = mutation({
  args: {
    conversationId: v.id("conversations"),
    message: v.string(),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get("conversations", args.conversationId);
    if (!conversation) {
      throw new Error("Conversation not found");
    }
    const { projectId } = conversation;
    await getOwnedProject(ctx, projectId);
    const requestedModel = assertCodingModelId(args.model);

    const cancelledMessageIds = await cancelProcessingMessagesInProject(
      ctx,
      projectId,
    );

    const userMessageId = await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      projectId,
      role: "user",
      content: args.message,
    });
    const assistantMessageId = await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      projectId,
      role: "assistant",
      content: "",
      status: "processing",
    });
    await ctx.db.patch("conversations", args.conversationId, {
      updatedAt: Date.now(),
      ...(requestedModel && { model: requestedModel }),
    });

    return {
      projectId,
      userMessageId,
      assistantMessageId,
      cancelledMessageIds,
      model: resolveCodingModelId(requestedModel ?? conversation.model),
    };
  },
});

export const setModel = mutation({
  args: {
    id: v.id("conversations"),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const conversation = await ctx.db.get("conversations", args.id);
    if (!conversation) {
      throw new Error("Conversation not found");
    }
    await getOwnedProject(ctx, conversation.projectId);
    await ctx.db.patch("conversations", args.id, {
      model: assertCodingModelId(args.model),
    });
  },
});

export const cancelProcessingMessages = mutation({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    await getOwnedProject(ctx, args.projectId);
    return await cancelProcessingMessagesInProject(ctx, args.projectId);
  },
});

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    title: v.string(),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await verifyAuth(ctx);
    const project = await ctx.db.get("projects", args.projectId);

    if (!project) {
      throw new Error("Project not found");
    }
    if (project.ownerId !== userId.subject) {
      throw new Error("Unauthorized to access this project");
    }

    const conversationId = await ctx.db.insert("conversations", {
      projectId: args.projectId,
      title: args.title,
      updatedAt: Date.now(),
      model: assertCodingModelId(args.model),
    });
    return conversationId;
  },
});

export const getById = query({
  args: {
    id: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const userId = await verifyAuth(ctx);
    const conversation = await ctx.db.get("conversations", args.id);

    if (!conversation) {
      throw new Error("Conversation not found");
    }

    const project = await ctx.db.get("projects", conversation.projectId);

    if (!project) {
      throw new Error("Project not found");
    }

    if (project.ownerId !== userId.subject) {
      throw new Error("Unauthorized to access this conversation");
    }

    return conversation;
  },
});

export const getByProjectId = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const userId = await verifyAuth(ctx);
    const project = await ctx.db.get("projects", args.projectId);

    if (!project) {
      throw new Error("Project not found");
    }

    if (project.ownerId !== userId.subject) {
      throw new Error("Unauthorized to access this project");
    }

    return await ctx.db
      .query("conversations")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .collect();
  },
});

export const getMessages = query({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    const userId = await verifyAuth(ctx);
    const conversation = await ctx.db.get("conversations", args.conversationId);

    if (!conversation) {
      throw new Error("Conversation not found");
    }

    const project = await ctx.db.get("projects", conversation.projectId);

    if (!project) {
      throw new Error("Project not found");
    }

    if (project.ownerId !== userId.subject) {
      throw new Error("Unauthorized to access this project");
    }

    return await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("asc")
      .collect();
  },
});
