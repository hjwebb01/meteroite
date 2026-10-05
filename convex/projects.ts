import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getOwnedProject, verifyAuth } from "./auth";

export const updateSettings = mutation({
  args: {
    id: v.id("projects"),
    settings: v.object({
      installCommand: v.optional(v.string()),
      devCommand: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const userId = await verifyAuth(ctx);
    const project = await ctx.db.get("projects", args.id);
    if (!project) {
      throw new Error("Project not found");
    }
    if (project.ownerId !== userId.subject) {
      throw new Error("Unauthorized access to this project");
    }
    await ctx.db.patch("projects", args.id, {
      settings: args.settings,
      updatedAt: Date.now(),
    });
  },
});

export const create = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await verifyAuth(ctx);
    const projectId = await ctx.db.insert("projects", {
      name: args.name,
      ownerId: userId.subject,
      updatedAt: Date.now(),
    });
    return projectId;
  },
});

export const getPartial = query({
  args: {
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await verifyAuth(ctx);

    return await ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId.subject))
      .order("desc")
      .take(args.limit);
  },
});

export const get = query({
  args: {},
  handler: async (ctx) => {
    const userId = await verifyAuth(ctx);
    return ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId.subject))
      .order("desc")
      .collect();
  },
});

export const getById = query({
  args: {
    id: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const userId = await verifyAuth(ctx);
    const project = await ctx.db.get("projects", args.id);
    if (!project) {
      throw new Error("Project not found");
    }

    if (project.ownerId !== userId.subject) {
      throw new Error("Unauthorized access to this project");
    }

    return project;
  },
});

export const rename = mutation({
  args: {
    id: v.id("projects"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await verifyAuth(ctx);
    const project = await ctx.db.get("projects", args.id);
    if (!project) {
      throw new Error("Project not found");
    }

    if (project.ownerId !== userId.subject) {
      throw new Error("Unauthorized access to this project");
    }

    await ctx.db.patch("projects", args.id, {
      name: args.name,
      updatedAt: Date.now(),
    });
  },
});

/** Returns false when an export is already running for the project. */
export const startExport = mutation({
  args: {
    projectId: v.id("projects"),
    jobId: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await getOwnedProject(ctx, args.projectId);
    if (project.exportStatus === "exporting") {
      return false;
    }
    await ctx.db.patch("projects", args.projectId, {
      exportStatus: "exporting",
      exportRepoUrl: undefined,
      exportJobId: args.jobId,
      updatedAt: Date.now(),
    });
    return true;
  },
});

/**
 * Returns the cancelled export's job id, or null if there is no run to signal
 * (nothing running, or a legacy export started before job ids existed).
 */
export const cancelExport = mutation({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const project = await getOwnedProject(ctx, args.projectId);
    if (project.exportStatus !== "exporting") {
      return null;
    }
    await ctx.db.patch("projects", args.projectId, {
      exportStatus: "cancelled",
      exportJobId: undefined,
      updatedAt: Date.now(),
    });
    return project.exportJobId ?? null;
  },
});

export const resetExport = mutation({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const project = await getOwnedProject(ctx, args.projectId);
    if (project.exportStatus === "exporting") {
      throw new Error("Cannot reset an export that is still running");
    }
    await ctx.db.patch("projects", args.projectId, {
      exportStatus: undefined,
      exportRepoUrl: undefined,
      exportJobId: undefined,
      updatedAt: Date.now(),
    });
  },
});
