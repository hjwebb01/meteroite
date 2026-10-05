import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

export const getConversationById = internalQuery({
  args: {
    conversationId: v.id("conversations"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.conversationId);
  },
});

const progressStepValidator = v.object({
  id: v.optional(v.string()),
  label: v.string(),
  description: v.optional(v.string()),
  status: v.optional(
    v.union(
      v.literal("pending"),
      v.literal("active"),
      v.literal("complete"),
      v.literal("error"),
    ),
  ),
  kind: v.optional(v.union(v.literal("phase"), v.literal("tool"))),
  toolName: v.optional(v.string()),
});

const turnSummaryValidator = v.object({
  filesRead: v.array(v.string()),
  filesChanged: v.array(
    v.object({
      action: v.union(
        v.literal("created"),
        v.literal("updated"),
        v.literal("deleted"),
        v.literal("renamed"),
        v.literal("folder"),
      ),
      path: v.string(),
      fileId: v.optional(v.string()),
    }),
  ),
  findings: v.array(v.string()),
});

export const createMessage = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    projectId: v.id("projects"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    status: v.optional(
      v.union(
        v.literal("processing"),
        v.literal("completed"),
        v.literal("cancelled"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const messageId = await ctx.db.insert("messages", {
      conversationId: args.conversationId,
      projectId: args.projectId,
      role: args.role,
      content: args.content,
      status: args.status,
    });
    await ctx.db.patch("conversations", args.conversationId, {
      updatedAt: Date.now(),
    });
    return messageId;
  },
});

export const updateMessageProgress = internalMutation({
  args: {
    messageId: v.id("messages"),
    progressLabel: v.optional(v.string()),
    progressSteps: v.optional(v.array(progressStepValidator)),
  },
  handler: async (ctx, args) => {
    const patch: {
      progressLabel?: string;
      progressSteps?: Array<{
        id?: string;
        label: string;
        description?: string;
        status?: "pending" | "active" | "complete" | "error";
        kind?: "phase" | "tool";
        toolName?: string;
      }>;
    } = {};
    if (args.progressLabel !== undefined) {
      patch.progressLabel = args.progressLabel;
    }
    if (args.progressSteps !== undefined) {
      patch.progressSteps = args.progressSteps;
    }
    const message = await ctx.db.get(args.messageId);
    // A cancelled or finished turn must not get progress back from a late worker write.
    if (message?.status !== "processing") {
      return;
    }
    await ctx.db.patch(args.messageId, patch);
  },
});

export const updateMessageContent = internalMutation({
  args: {
    messageId: v.id("messages"),
    content: v.string(),
    turnSummary: v.optional(turnSummaryValidator),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (message?.status !== "processing") {
      return;
    }
    await ctx.db.patch(args.messageId, {
      content: args.content,
      status: "completed" as const,
      ...(args.turnSummary ? { turnSummary: args.turnSummary } : {}),
    });
  },
});

export const getRecentMessages = internalQuery({
  args: {
    conversationId: v.id("conversations"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;
    const newestFirst = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("desc")
      .take(limit);

    // Oldest first, without the bulky progress fields history never uses.
    return newestFirst.reverse().map((message) => ({
      _id: message._id,
      role: message.role,
      content: message.content,
      status: message.status,
      turnSummary: message.turnSummary,
    }));
  },
});

export const updateConversationTitle = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.conversationId, {
      title: args.title,
      updatedAt: Date.now(),
    });
  },
});
