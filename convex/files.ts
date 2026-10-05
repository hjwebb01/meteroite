import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { getOwnedProject, verifyAuth } from "./auth";
import * as projectFiles from "./lib/project-files";

export const getFiles = query({
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
    return ctx.db
      .query("files")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

export const getFile = query({
  args: {
    id: v.id("files"),
  },
  handler: async (ctx, args) => {
    const userId = await verifyAuth(ctx);
    const file = await ctx.db.get("files", args.id);
    if (!file) {
      throw new Error("File not found");
    }
    const project = await ctx.db.get("projects", file.projectId);
    if (!project) {
      throw new Error("Project not found");
    }
    if (project.ownerId !== userId.subject) {
      throw new Error("Unauthorized to access this file");
    }
    return file;
  },
});

export const getFolderContents = query({
  args: {
    projectId: v.id("projects"),
    parentId: v.optional(v.id("files")),
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
    const files = await ctx.db
      .query("files")
      .withIndex("by_project_parent", (q) =>
        q.eq("projectId", args.projectId).eq("parentId", args.parentId),
      )
      .collect();
    // Sort: Folders -> Files, Alphabetical within each group
    return files.sort((a, b) => {
      if (a.type === "folder" && b.type !== "folder") return -1;
      if (a.type !== "folder" && b.type === "folder") return 1;
      return a.name.localeCompare(b.name);
    });
  },
});

export const getFilePath = query({
  args: {
    id: v.id("files"),
  },
  handler: async (ctx, args) => {
    const userId = await verifyAuth(ctx);
    const file = await ctx.db.get("files", args.id);
    if (!file) {
      throw new Error("File not found");
    }
    const project = await ctx.db.get("projects", file.projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    if (project.ownerId !== userId.subject) {
      throw new Error("Unauthorized to access this project");
    }
    const path: { _id: string; name: string }[] = [];
    let current: Id<"files"> | undefined = args.id;

    while (current) {
      const file = (await ctx.db.get("files", current)) as
        | Doc<"files">
        | undefined;
      if (!file) break;
      path.unshift({ _id: file._id, name: file.name });
      current = file.parentId;
    }
    return path;
  },
});

export const createFile = mutation({
  args: {
    projectId: v.id("projects"),
    parentId: v.optional(v.id("files")),
    name: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    await getOwnedProject(ctx, args.projectId);
    await projectFiles.createFile(ctx, args);
  },
});

export const createFolder = mutation({
  args: {
    projectId: v.id("projects"),
    parentId: v.optional(v.id("files")),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    await getOwnedProject(ctx, args.projectId);
    await projectFiles.createFolder(ctx, args);
  },
});

export const renameFile = mutation({
  args: {
    id: v.id("files"),
    newName: v.string(),
  },
  handler: async (ctx, args) => {
    await verifyAuth(ctx);
    const file = await ctx.db.get("files", args.id);
    if (!file) {
      throw new Error("File not found");
    }
    await getOwnedProject(ctx, file.projectId);
    await projectFiles.renameEntry(ctx, {
      projectId: file.projectId,
      fileId: args.id,
      newName: args.newName,
    });
  },
});

export const deleteFile = mutation({
  args: {
    id: v.id("files"),
  },
  handler: async (ctx, args) => {
    await verifyAuth(ctx);
    const file = await ctx.db.get("files", args.id);
    if (!file) {
      return;
    }
    await getOwnedProject(ctx, file.projectId);
    await projectFiles.deleteEntry(ctx, {
      projectId: file.projectId,
      fileId: args.id,
    });
  },
});

export const updateFile = mutation({
  args: {
    id: v.id("files"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    await verifyAuth(ctx);
    const file = await ctx.db.get("files", args.id);
    if (!file) {
      throw new Error("File not found");
    }
    await getOwnedProject(ctx, file.projectId);
    await projectFiles.updateTextFile(ctx, {
      projectId: file.projectId,
      fileId: args.id,
      content: args.content,
    });
  },
});
