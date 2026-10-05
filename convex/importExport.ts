import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import * as projectFiles from "./lib/project-files";

// Text-file creation used by GitHub import
export const createSingleFile = internalMutation({
  args: {
    projectId: v.id("projects"),
    parentId: v.optional(v.id("files")),
    name: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    return projectFiles.createFile(ctx, {
      projectId: args.projectId,
      parentId: args.parentId,
      name: args.name,
      content: args.content,
    });
  },
});

// Folder creation used by GitHub import
export const createFolder = internalMutation({
  args: {
    projectId: v.id("projects"),
    parentId: v.optional(v.id("files")),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    return projectFiles.createFolder(ctx, {
      projectId: args.projectId,
      parentId: args.parentId,
      name: args.name,
    });
  },
});

export const cleanup = internalMutation({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    return projectFiles.clearProjectFiles(ctx, args.projectId);
  },
});

export const generateUploadUrl = internalMutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const createBinaryFile = internalMutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    storageId: v.id("_storage"),
    parentId: v.optional(v.id("files")),
  },
  handler: async (ctx, args) => {
    return projectFiles.createFile(ctx, {
      projectId: args.projectId,
      parentId: args.parentId,
      name: args.name,
      storageId: args.storageId,
    });
  },
});

export const updateImportStatus = internalMutation({
  args: {
    projectId: v.id("projects"),
    status: v.optional(
      v.union(
        v.literal("importing"),
        v.literal("completed"),
        v.literal("failed"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch("projects", args.projectId, {
      importStatus: args.status,
      updatedAt: Date.now(),
    });
  },
});

/** Finishes an export run; ignored unless `jobId` is still the project's active export. */
export const finishExport = internalMutation({
  args: {
    projectId: v.id("projects"),
    jobId: v.string(),
    status: v.union(v.literal("completed"), v.literal("failed")),
    repoUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get("projects", args.projectId);
    if (
      project?.exportStatus !== "exporting" ||
      project.exportJobId !== args.jobId
    ) {
      return;
    }
    await ctx.db.patch("projects", args.projectId, {
      exportStatus: args.status,
      exportRepoUrl: args.repoUrl,
      exportJobId: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const getProjectFilesWithUrls = internalQuery({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const files = await ctx.db
      .query("files")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    return await Promise.all(
      files.map(async (file) => {
        if (file.storageId) {
          const url = await ctx.storage.getUrl(file.storageId);
          return { ...file, storageUrl: url };
        }
        return { ...file, storageUrl: null };
      }),
    );
  },
});

export const createProject = internalMutation({
  args: {
    name: v.string(),
    ownerId: v.string(),
  },
  handler: async (ctx, args) => {
    const projectId = await ctx.db.insert("projects", {
      name: args.name,
      ownerId: args.ownerId,
      updatedAt: Date.now(),
      importStatus: "importing",
    });

    return projectId;
  },
});

export const createProjectWithConversation = internalMutation({
  args: {
    projectName: v.string(),
    conversationTitle: v.string(),
    ownerId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    const projectId = await ctx.db.insert("projects", {
      name: args.projectName,
      ownerId: args.ownerId,
      updatedAt: now,
    });

    const conversationId = await ctx.db.insert("conversations", {
      projectId,
      title: args.conversationTitle,
      updatedAt: now,
    });

    return { projectId, conversationId };
  },
});
