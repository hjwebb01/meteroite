import { MAX_AGENT_CREATE_FILES_PER_MUTATION } from "./agentLimits";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import * as projectFiles from "./lib/project-files";
import { normalizeWorkspacePathToSegments } from "./lib/project-files";
import { v } from "convex/values";

const projectFileWithPathRow = v.object({
  id: v.id("files"),
  name: v.string(),
  type: v.union(v.literal("file"), v.literal("folder")),
  parentId: v.union(v.id("files"), v.null()),
  path: v.string(),
});

const agentEnsureFolderPathResult = v.object({
  folderId: v.id("files"),
  path: v.string(),
  createdNewFolders: v.boolean(),
});

const agentCreateFileResultRow = v.object({
  path: v.string(),
  fileId: v.optional(v.id("files")),
  error: v.optional(v.string()),
});

/** Single path or id resolution result for the coding agent read tool. */
const agentReadFileResultRow = v.union(
  v.object({
    status: v.literal("ok"),
    path: v.string(),
    id: v.id("files"),
    name: v.string(),
    content: v.string(),
    truncated: v.optional(v.boolean()),
    totalChars: v.optional(v.number()),
  }),
  v.object({
    status: v.literal("missing"),
    path: v.string(),
  }),
  v.object({
    status: v.literal("folder"),
    path: v.string(),
    id: v.id("files"),
    name: v.string(),
  }),
  v.object({
    status: v.literal("binary"),
    path: v.string(),
    id: v.id("files"),
    name: v.string(),
  }),
  v.object({
    status: v.literal("invalid_id"),
    requestedId: v.string(),
  }),
  v.object({
    status: v.literal("invalid_path"),
    input: v.string(),
    message: v.string(),
  }),
);

/** Compact list payload for agent listFiles (token-efficient). */
const agentListCompactPayload = v.object({
  v: v.literal(2),
  cols: v.array(v.string()),
  rows: v.array(
    v.array(v.union(v.string(), v.null())),
  ),
  truncated: v.boolean(),
  nextCursor: v.union(v.number(), v.null()),
  totalCount: v.number(),
});

const agentResolveFileIdRow = v.union(
  v.object({
    status: v.literal("ok"),
    raw: v.string(),
    fileId: v.id("files"),
  }),
  v.object({
    status: v.literal("invalid"),
    raw: v.string(),
  }),
);

const validateInternalKey = (key: string) => {
  const internalKey = process.env.METEROITE_CONVEX_INTERNAL_KEY;
  if (!internalKey) {
    throw new Error("METEROITE_CONVEX_INTERNAL_KEY key is not set");
  }
  if (key !== internalKey) {
    throw new Error("Invalid internal key");
  }
};

/**
 * Computes workspace-relative paths for every file/folder in a project.
 * Used by getProjectFilesWithPaths and agentReadFiles.
 */
function buildPathsForProjectFiles(files: Doc<"files">[]): {
  pathById: Map<Id<"files">, string>;
  fileByPath: Map<string, Doc<"files">>;
} {
  const byId = new Map(files.map((f) => [f._id, f]));
  const pathCache = new Map<Id<"files">, string>();
  const maxDepth = files.length + 1;

  const pathFor = (
    id: Id<"files">,
    chain: Set<Id<"files">>,
    depth: number,
  ): string => {
    const cached = pathCache.get(id);
    if (cached !== undefined) {
      return cached;
    }
    if (depth > maxDepth) {
      throw new Error("Invalid file tree: path depth exceeds project file count");
    }
    if (chain.has(id)) {
      throw new Error("Invalid file tree: cycle in parent chain");
    }
    const node = byId.get(id);
    if (!node) {
      throw new Error("Invalid file tree: missing file record");
    }
    chain.add(id);
    try {
      if (!node.parentId) {
        const result = node.name;
        pathCache.set(id, result);
        return result;
      }
      if (!byId.get(node.parentId)) {
        throw new Error("Invalid file tree: parent record not found");
      }
      const parentPath = pathFor(node.parentId, chain, depth + 1);
      const result = parentPath ? `${parentPath}/${node.name}` : node.name;
      pathCache.set(id, result);
      return result;
    } finally {
      chain.delete(id);
    }
  };

  const pathById = new Map<Id<"files">, string>();
  const fileByPath = new Map<string, Doc<"files">>();
  for (const f of files) {
    const p = pathFor(f._id, new Set(), 0);
    pathById.set(f._id, p);
    fileByPath.set(p, f);
  }
  return { pathById, fileByPath };
}

function fileDocToAgentReadResult(
  doc: Doc<"files">,
  path: string,
):
  | {
      status: "ok";
      path: string;
      id: Id<"files">;
      name: string;
      content: string;
      truncated?: boolean;
      totalChars?: number;
    }
  | {
      status: "folder";
      path: string;
      id: Id<"files">;
      name: string;
    }
  | {
      status: "binary";
      path: string;
      id: Id<"files">;
      name: string;
    } {
  if (doc.type === "folder") {
    return { status: "folder", path, id: doc._id, name: doc.name };
  }
  if (doc.storageId) {
    return { status: "binary", path, id: doc._id, name: doc.name };
  }
  return {
    status: "ok",
    path,
    id: doc._id,
    name: doc.name,
    content: doc.content ?? "",
  };
}

function matchesWorkspacePathPrefix(path: string, prefixRaw: string): boolean {
  const p = prefixRaw.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!p) {
    return true;
  }
  return path === p || path.startsWith(`${p}/`);
}

function sliceContentByLines(
  content: string,
  lineStart?: number,
  lineEnd?: number,
): string {
  if (lineStart == null && lineEnd == null) {
    return content;
  }
  const lines = content.split("\n");
  const start = Math.max(0, (lineStart ?? 1) - 1);
  const end = lineEnd == null ? lines.length : Math.max(start, lineEnd);
  return lines.slice(start, end).join("\n");
}

function applyReadSizeLimits(
  content: string,
  maxChars: number,
  lineStart?: number,
  lineEnd?: number,
): { text: string; truncated: boolean; totalChars: number } {
  let text = sliceContentByLines(content, lineStart, lineEnd);
  const totalChars = text.length;
  const cap = Math.min(Math.max(maxChars, 1), 500_000);
  if (text.length > cap) {
    text = text.slice(0, cap);
    return { text, truncated: true, totalChars };
  }
  return { text, truncated: false, totalChars };
}

export const getConversationById = query({
  args: {
    conversationId: v.id("conversations"),
    internalKey: v.string(),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);

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

export const createMessage = mutation({
  args: {
    internalKey: v.string(),
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
    validateInternalKey(args.internalKey);
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

export const updateMessageProgress = mutation({
  args: {
    internalKey: v.string(),
    messageId: v.id("messages"),
    progressLabel: v.optional(v.string()),
    progressSteps: v.optional(v.array(progressStepValidator)),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);
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
    await ctx.db.patch(args.messageId, patch);
  },
});

export const updateMessageContent = mutation({
  args: {
    internalKey: v.string(),
    messageId: v.id("messages"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);
    await ctx.db.patch(args.messageId, {
      content: args.content,
      status: "completed" as const,
    });
  },
});

export const getProcessingMessages = query({
  args: {
    internalKey: v.string(),
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);
    return await ctx.db
      .query("messages")
      .withIndex("by_project_status", (q) =>
        q.eq("projectId", args.projectId).eq("status", "processing"),
      )
      .collect();
  },
});

export const updateMessageStatus = mutation({
  args: {
    internalKey: v.string(),
    messageId: v.id("messages"),
    status: v.union(
      v.literal("processing"),
      v.literal("completed"),
      v.literal("cancelled"),
    ),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);
    if (args.status === "cancelled") {
      await ctx.db.patch(args.messageId, {
        status: args.status,
        progressLabel: undefined,
        progressSteps: undefined,
      });
    } else {
      await ctx.db.patch(args.messageId, {
        status: args.status,
      });
    }
  },
});

export const getRecentMessages = query({
  args: {
    internalKey: v.string(),
    conversationId: v.id("conversations"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) =>
        q.eq("conversationId", args.conversationId),
      )
      .order("asc")
      .collect();
    const limit = args.limit ?? 10;

    return messages.slice(-limit);
  },
});

export const updateConversationTitle = mutation({
  args: {
    internalKey: v.string(),
    conversationId: v.id("conversations"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);
    await ctx.db.patch(args.conversationId, {
      title: args.title,
      updatedAt: Date.now(),
    });
  },
});

// "ListFiles" tool used by the coding agent
export const getProjectFiles = query({
  args: {
    internalKey: v.string(),
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);
    return await ctx.db
      .query("files")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

/** Same as getProjectFiles but each item includes a resolved workspace-relative `path`. */
export const getProjectFilesWithPaths = query({
  args: {
    internalKey: v.string(),
    projectId: v.id("projects"),
  },
  returns: v.array(projectFileWithPathRow),
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);
    const files = await ctx.db
      .query("files")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const { pathById } = buildPathsForProjectFiles(files);

    return files.map((f) => ({
      id: f._id,
      name: f.name,
      type: f.type,
      parentId: f.parentId ?? null,
      path: pathById.get(f._id)!,
    }));
  },
});

/**
 * Coding agent: list project files with optional compact format, path prefix, and pagination.
 */
export const agentListProjectFiles = query({
  args: {
    internalKey: v.string(),
    projectId: v.id("projects"),
    format: v.optional(v.union(v.literal("full"), v.literal("compact"))),
    pathPrefix: v.optional(v.string()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.number()),
  },
  returns: v.union(v.array(projectFileWithPathRow), agentListCompactPayload),
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);
    const format = args.format ?? "compact";
    const limit = Math.min(Math.max(args.limit ?? 500, 1), 5000);
    const cursor = Math.max(args.cursor ?? 0, 0);
    const prefix = args.pathPrefix ?? "";

    const files = await ctx.db
      .query("files")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const { pathById } = buildPathsForProjectFiles(files);

    const rows = files.map((f) => ({
      id: f._id,
      name: f.name,
      type: f.type,
      parentId: f.parentId ?? null,
      path: pathById.get(f._id)!,
    }));

    const filtered = prefix
      ? rows.filter((r) => matchesWorkspacePathPrefix(r.path, prefix))
      : rows;
    filtered.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "folder" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    const totalCount = filtered.length;
    const page = filtered.slice(cursor, cursor + limit);
    const truncated = cursor + page.length < totalCount;
    const nextCursor = truncated ? cursor + page.length : null;

    if (format === "full") {
      return page;
    }

    return {
      v: 2 as const,
      cols: ["i", "t", "p", "r"],
      rows: page.map((r) => [
        r.id,
        r.type === "file" ? "f" : "d",
        r.path,
        r.parentId,
      ]),
      truncated,
      nextCursor,
      totalCount,
    };
  },
});

/**
 * Coding agent: read files by workspace-relative path and/or by file id.
 * Paths and ids are scoped to projectId. Invalid ids never reach v.id validation.
 */
export const agentReadFiles = query({
  args: {
    internalKey: v.string(),
    projectId: v.id("projects"),
    paths: v.optional(v.array(v.string())),
    fileIds: v.optional(v.array(v.string())),
    maxChars: v.optional(v.number()),
    lineStart: v.optional(v.number()),
    lineEnd: v.optional(v.number()),
  },
  returns: v.array(agentReadFileResultRow),
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);
    const pathInputs = args.paths ?? [];
    const idInputs = args.fileIds ?? [];
    if (pathInputs.length === 0 && idInputs.length === 0) {
      throw new Error("Provide at least one path or fileId");
    }

    const maxChars = args.maxChars ?? 100_000;
    const lineStart = args.lineStart;
    const lineEnd = args.lineEnd;

    const files = await ctx.db
      .query("files")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const { pathById, fileByPath } = buildPathsForProjectFiles(files);

    const results: Array<
      | {
          status: "ok";
          path: string;
          id: Id<"files">;
          name: string;
          content: string;
          truncated?: boolean;
          totalChars?: number;
        }
      | { status: "missing"; path: string }
      | {
          status: "folder";
          path: string;
          id: Id<"files">;
          name: string;
        }
      | {
          status: "binary";
          path: string;
          id: Id<"files">;
          name: string;
        }
      | { status: "invalid_id"; requestedId: string }
      | { status: "invalid_path"; input: string; message: string }
    > = [];

    const pushResolved = (doc: Doc<"files">, path: string) => {
      const base = fileDocToAgentReadResult(doc, path);
      if (base.status !== "ok") {
        results.push(base);
        return;
      }
      const fullText = doc.content ?? "";
      const { text, truncated, totalChars } = applyReadSizeLimits(
        fullText,
        maxChars,
        lineStart,
        lineEnd,
      );
      results.push({
        ...base,
        content: text,
        ...(truncated ? { truncated: true, totalChars } : {}),
      });
    };

    for (const raw of pathInputs) {
      let key: string;
      try {
        const segments = normalizeWorkspacePathToSegments(raw);
        key = segments.join("/");
      } catch (e) {
        results.push({
          status: "invalid_path",
          input: raw,
          message: e instanceof Error ? e.message : String(e),
        });
        continue;
      }
      const doc = fileByPath.get(key);
      if (!doc) {
        results.push({ status: "missing", path: key });
        continue;
      }
      const path = pathById.get(doc._id)!;
      pushResolved(doc, path);
    }

    for (const raw of idInputs) {
      const matched = files.find((f) => f._id === raw);
      if (!matched) {
        results.push({ status: "invalid_id", requestedId: raw });
        continue;
      }
      const path = pathById.get(matched._id)!;
      pushResolved(matched, path);
    }

    return results;
  },
});

/** Coding agent: resolve raw file id strings against a project (for mutations). */
export const agentResolveFileIdsInProject = query({
  args: {
    internalKey: v.string(),
    projectId: v.id("projects"),
    rawIds: v.array(v.string()),
  },
  returns: v.array(agentResolveFileIdRow),
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);
    const files = await ctx.db
      .query("files")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const valid = new Set(files.map((f) => f._id as string));
    return args.rawIds.map((raw) => {
      if (valid.has(raw)) {
        return {
          status: "ok" as const,
          raw,
          fileId: raw as Id<"files">,
        };
      }
      return { status: "invalid" as const, raw };
    });
  },
});
// "ReadFile" tool used by the coding agent
export const getFileById = query({
  args: {
    internalKey: v.string(),
    fileId: v.id("files"),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);
    return await ctx.db.get(args.fileId);
  },
});

// "UpdateFile" tool used by the coding agent
export const updateFile = mutation({
  args: {
    internalKey: v.string(),
    projectId: v.id("projects"),
    fileId: v.id("files"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);
    return projectFiles.updateTextFile(ctx, {
      projectId: args.projectId,
      fileId: args.fileId,
      content: args.content,
    });
  },
});

/** Internal batch entry: failed writes, including new parents, roll back together. */
export const createBatchFile = internalMutation({
  args: {
    projectId: v.id("projects"),
    location: v.union(
      v.object({ path: v.string() }),
      v.object({ parentId: v.optional(v.id("files")), name: v.string() }),
    ),
    content: v.string(),
  },
  returns: v.id("files"),
  handler: async (ctx, args): Promise<Id<"files">> => {
    if ("path" in args.location) {
      return projectFiles.createFileAtPath(ctx, {
        projectId: args.projectId,
        path: args.location.path,
        content: args.content,
      });
    }
    return projectFiles.createFile(ctx, {
      projectId: args.projectId,
      ...args.location,
      content: args.content,
    });
  },
});

// Text-file creation used by GitHub import
export const createSingleFile = mutation({
  args: {
    internalKey: v.string(),
    projectId: v.id("projects"),
    parentId: v.optional(v.id("files")),
    name: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);
    return projectFiles.createFile(ctx, {
      projectId: args.projectId,
      parentId: args.parentId,
      name: args.name,
      content: args.content,
    });
  },
});

// "CreateFiles" tool used by the coding agent (bulk create files)
export const createFiles = mutation({
  args: {
    internalKey: v.string(),
    projectId: v.id("projects"),
    parentId: v.optional(v.id("files")),
    files: v.array(
      v.object({
        name: v.string(),
        content: v.string(),
      }),
    ),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ name: string; fileId: string; error?: string }[]> => {
    validateInternalKey(args.internalKey);
    const results: { name: string; fileId: string; error?: string }[] = [];
    for (const file of args.files) {
      try {
        const fileId: Id<"files"> = await ctx.runMutation(
          internal.system.createBatchFile,
          {
            projectId: args.projectId,
            location: { parentId: args.parentId, name: file.name },
            content: file.content,
          },
        );
        results.push({ name: file.name, fileId });
      } catch (error) {
        const existing = await ctx.db
          .query("files")
          .withIndex("by_project_parent", (q) =>
            q.eq("projectId", args.projectId).eq("parentId", args.parentId),
          )
          .filter((q) => q.eq(q.field("name"), file.name))
          .first();
        results.push({
          name: file.name,
          fileId: existing?._id ?? "",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  },
});

// Folder creation used by GitHub import
export const createFolder = mutation({
  args: {
    internalKey: v.string(),
    projectId: v.id("projects"),
    parentId: v.optional(v.id("files")),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);
    return projectFiles.createFolder(ctx, {
      projectId: args.projectId,
      parentId: args.parentId,
      name: args.name,
    });
  },
});

/**
 * Coding agent: ensure a folder exists at a workspace-relative path (creates missing segments).
 * Prefer this over createFolder + parent IDs.
 */
export const agentEnsureFolderPath = mutation({
  args: {
    internalKey: v.string(),
    projectId: v.id("projects"),
    path: v.string(),
  },
  returns: agentEnsureFolderPathResult,
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);
    return projectFiles.ensureFolderPath(ctx, {
      projectId: args.projectId,
      path: args.path,
    });
  },
});

/**
 * Coding agent: create files at workspace-relative paths; auto-creates parent folders.
 * Each entry is `{ path, content }` (e.g. `package.json` and `src/app.tsx` in one call).
 */
export const agentCreateFilesByPaths = mutation({
  args: {
    internalKey: v.string(),
    projectId: v.id("projects"),
    files: v.array(
      v.object({
        path: v.string(),
        content: v.string(),
      }),
    ),
  },
  returns: v.array(agentCreateFileResultRow),
  handler: async (
    ctx,
    args,
  ): Promise<{ path: string; fileId?: Id<"files">; error?: string }[]> => {
    validateInternalKey(args.internalKey);
    if (args.files.length > MAX_AGENT_CREATE_FILES_PER_MUTATION) {
      throw new Error(
        `Too many files in one request (max ${MAX_AGENT_CREATE_FILES_PER_MUTATION})`,
      );
    }
    const results: { path: string; fileId?: Id<"files">; error?: string }[] =
      [];
    for (const file of args.files) {
      try {
        const fileId: Id<"files"> = await ctx.runMutation(
          internal.system.createBatchFile,
          {
            projectId: args.projectId,
            location: { path: file.path },
            content: file.content,
          },
        );
        results.push({ path: file.path, fileId });
      } catch (error) {
        results.push({
          path: file.path,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  },
});

// "RenameFile" tool used by the coding agent
export const renameFile = mutation({
  args: {
    internalKey: v.string(),
    projectId: v.id("projects"),
    fileId: v.id("files"),
    newName: v.string(),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);
    return projectFiles.renameEntry(ctx, {
      projectId: args.projectId,
      fileId: args.fileId,
      newName: args.newName,
    });
  },
});

// "DeleteFile" tool used by the coding agent
export const deleteFile = mutation({
  args: {
    internalKey: v.string(),
    projectId: v.id("projects"),
    fileId: v.id("files"),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);
    return projectFiles.deleteEntry(ctx, {
      projectId: args.projectId,
      fileId: args.fileId,
    });
  },
});

export const agentDeleteFiles = mutation({
  args: {
    internalKey: v.string(),
    projectId: v.id("projects"),
    rawIds: v.array(v.string()),
  },
  returns: v.array(v.object({
    fileId: v.id("files"),
    name: v.optional(v.string()),
    type: v.optional(v.union(v.literal("file"), v.literal("folder"))),
    alreadyMissing: v.boolean(),
  })),
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);
    return projectFiles.deleteEntries(ctx, {
      projectId: args.projectId,
      rawIds: args.rawIds,
    });
  },
});

export const cleanup = mutation({
  args: {
    internalKey: v.string(),
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);
    return projectFiles.clearProjectFiles(ctx, args.projectId);
  },
});

export const generateUploadUrl = mutation({
  args: {
    internalKey: v.string(),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);
    return await ctx.storage.generateUploadUrl();
  },
});

export const createBinaryFile = mutation({
  args: {
    internalKey: v.string(),
    projectId: v.id("projects"),
    name: v.string(),
    storageId: v.id("_storage"),
    parentId: v.optional(v.id("files")),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);
    return projectFiles.createFile(ctx, {
      projectId: args.projectId,
      parentId: args.parentId,
      name: args.name,
      storageId: args.storageId,
    });
  },
});

export const updateImportStatus = mutation({
  args: {
    internalKey: v.string(),
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
    validateInternalKey(args.internalKey);

    await ctx.db.patch("projects", args.projectId, {
      importStatus: args.status,
      updatedAt: Date.now(),
    });
  },
});

export const updateExportStatus = mutation({
  args: {
    internalKey: v.string(),
    projectId: v.id("projects"),
    status: v.optional(
      v.union(
        v.literal("exporting"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled"),
      ),
    ),
    repoUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);

    await ctx.db.patch("projects", args.projectId, {
      exportStatus: args.status,
      exportRepoUrl: args.repoUrl,
      updatedAt: Date.now(),
    });
  },
});

export const getProjectFilesWithUrls = query({
  args: {
    internalKey: v.string(),
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);

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

export const createProject = mutation({
  args: {
    internalKey: v.string(),
    name: v.string(),
    ownerId: v.string(),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);

    const projectId = await ctx.db.insert("projects", {
      name: args.name,
      ownerId: args.ownerId,
      updatedAt: Date.now(),
      importStatus: "importing",
    });

    return projectId;
  },
});

export const createProjectWithConversation = mutation({
  args: {
    internalKey: v.string(),
    projectName: v.string(),
    conversationTitle: v.string(),
    ownerId: v.string(),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);

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
// TODO: Add more tools
