import { MAX_AGENT_CREATE_FILES_PER_MUTATION } from "./agentLimits";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
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

/** Workspace-relative path: forward slashes, no leading slash, no `.` / `..` segments. */
function normalizeWorkspacePathToSegments(raw: string): string[] {
  const trimmed = raw.trim().replace(/\\/g, "/");
  if (!trimmed) {
    throw new Error("Path cannot be empty");
  }
  if (trimmed.startsWith("/")) {
    throw new Error("Path must be workspace-relative (no leading slash)");
  }
  const segments = trimmed.split("/").filter((s) => s.length > 0);
  for (const seg of segments) {
    if (seg === "." || seg === "..") {
      throw new Error(`Invalid path segment: ${seg}`);
    }
    if (seg.includes("/") || seg.includes("\\")) {
      throw new Error("Invalid path segment");
    }
  }
  return segments;
}

function splitFilePathForCreate(raw: string): {
  dirSegments: string[];
  fileName: string;
} {
  const segments = normalizeWorkspacePathToSegments(raw);
  if (segments.length === 0) {
    throw new Error("File path cannot be empty");
  }
  const fileName = segments[segments.length - 1]!;
  const dirSegments = segments.slice(0, -1);
  return { dirSegments, fileName };
}

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

async function getOrCreateFolder(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  parentId: Id<"files"> | undefined,
  segmentName: string,
): Promise<{ id: Id<"files">; created: boolean }> {
  const siblings = await ctx.db
    .query("files")
    .withIndex("by_project_parent", (q) =>
      q.eq("projectId", projectId).eq("parentId", parentId),
    )
    .collect();

  const existingFolder = siblings.find(
    (f) => f.name === segmentName && f.type === "folder",
  );
  if (existingFolder) {
    return { id: existingFolder._id, created: false };
  }

  const blockingFile = siblings.find(
    (f) => f.name === segmentName && f.type === "file",
  );
  if (blockingFile) {
    throw new Error(
      `Cannot create folder "${segmentName}": a file exists at that path`,
    );
  }

  const id = await ctx.db.insert("files", {
    projectId,
    name: segmentName,
    type: "folder",
    parentId,
    updatedAt: Date.now(),
  });
  return { id, created: true };
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
  label: v.string(),
  description: v.optional(v.string()),
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
      progressSteps?: Array<{ label: string; description?: string }>;
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
      progressLabel: undefined,
      progressSteps: undefined,
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

    let filtered = prefix
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
    const file = await ctx.db.get(args.fileId);
    if (!file) {
      throw new Error("File not found");
    }
    if (file.projectId !== args.projectId) {
      throw new Error("File does not belong to this project");
    }
    await ctx.db.patch(args.fileId, {
      content: args.content,
      updatedAt: Date.now(),
    });

    return args.fileId;
  },
});

// "CreateSingleFile" tool used by the coding agent
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

    const files = await ctx.db
      .query("files")
      .withIndex("by_project_parent", (q) =>
        q.eq("projectId", args.projectId).eq("parentId", args.parentId),
      )
      .collect();
    const existing = files.find(
      (file) => file.name === args.name && file.type !== "folder",
    );
    if (existing) {
      throw new Error("File with this name already exists");
    }
    const fileId = await ctx.db.insert("files", {
      projectId: args.projectId,
      name: args.name,
      content: args.content,
      type: "file",
      parentId: args.parentId,
      updatedAt: Date.now(),
    });
    return fileId;
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
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);
    const existingFiles = await ctx.db
      .query("files")
      .withIndex("by_project_parent", (q) =>
        q.eq("projectId", args.projectId).eq("parentId", args.parentId),
      )
      .collect();
    const results: { name: string; fileId: string; error?: string }[] = [];
    for (const file of args.files) {
      const existing = existingFiles.find(
        (existing) => existing.name === file.name && existing.type !== "folder",
      );
      if (existing) {
        results.push({
          name: file.name,
          fileId: existing._id,
          error: `File with this name already exists: ${existing.name}`,
        });
        continue;
      }
      const fileId = await ctx.db.insert("files", {
        projectId: args.projectId,
        name: file.name,
        content: file.content,
        type: "file",
        parentId: args.parentId,
        updatedAt: Date.now(),
      });
      results.push({
        name: file.name,
        fileId,
      });
    }
    return results;
  },
});

// "CreateFolder" tool used by the coding agent
export const createFolder = mutation({
  args: {
    internalKey: v.string(),
    projectId: v.id("projects"),
    parentId: v.optional(v.id("files")),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);

    const files = await ctx.db
      .query("files")
      .withIndex("by_project_parent", (q) =>
        q.eq("projectId", args.projectId).eq("parentId", args.parentId),
      )
      .collect();
    const existing = files.find(
      (file) => file.name === args.name && file.type === "folder",
    );
    if (existing) {
      throw new Error("Folder with this name already exists");
    }
    const fileId = await ctx.db.insert("files", {
      projectId: args.projectId,
      name: args.name,
      type: "folder",
      parentId: args.parentId,
      updatedAt: Date.now(),
    });
    return fileId;
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
    const segments = normalizeWorkspacePathToSegments(args.path);
    if (segments.length === 0) {
      throw new Error("Folder path cannot be empty");
    }
    let parentId: Id<"files"> | undefined = undefined;
    let createdNewFolders = false;
    for (const seg of segments) {
      const { id, created } = await getOrCreateFolder(
        ctx,
        args.projectId,
        parentId,
        seg,
      );
      if (created) {
        createdNewFolders = true;
      }
      parentId = id;
    }
    return {
      folderId: parentId!,
      path: segments.join("/"),
      createdNewFolders,
    };
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
  handler: async (ctx, args) => {
    validateInternalKey(args.internalKey);
    if (args.files.length > MAX_AGENT_CREATE_FILES_PER_MUTATION) {
      throw new Error(
        `Too many files in one request (max ${MAX_AGENT_CREATE_FILES_PER_MUTATION})`,
      );
    }
    const results: {
      path: string;
      fileId?: Id<"files">;
      error?: string;
    }[] = [];

    for (const file of args.files) {
      try {
        const { dirSegments, fileName } = splitFilePathForCreate(file.path);
        let parentId: Id<"files"> | undefined = undefined;
        for (const seg of dirSegments) {
          const { id } = await getOrCreateFolder(
            ctx,
            args.projectId,
            parentId,
            seg,
          );
          parentId = id;
        }

        const siblings = await ctx.db
          .query("files")
          .withIndex("by_project_parent", (q) =>
            q.eq("projectId", args.projectId).eq("parentId", parentId),
          )
          .collect();

        const existingFile = siblings.find(
          (f) => f.name === fileName && f.type === "file",
        );
        if (existingFile) {
          results.push({
            path: file.path,
            error: `File already exists: ${fileName}`,
          });
          continue;
        }

        const folderConflict = siblings.find(
          (f) => f.name === fileName && f.type === "folder",
        );
        if (folderConflict) {
          results.push({
            path: file.path,
            error: `A folder exists at that path: ${fileName}`,
          });
          continue;
        }

        const fileId = await ctx.db.insert("files", {
          projectId: args.projectId,
          name: fileName,
          content: file.content,
          type: "file",
          parentId,
          updatedAt: Date.now(),
        });
        results.push({ path: file.path, fileId });
      } catch (e) {
        results.push({
          path: file.path,
          error: e instanceof Error ? e.message : String(e),
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
    const file = await ctx.db.get(args.fileId);
    if (!file) {
      throw new Error("File not found");
    }
    if (file.projectId !== args.projectId) {
      throw new Error("File does not belong to this project");
    }
    const siblings = await ctx.db
      .query("files")
      .withIndex("by_project_parent", (q) =>
        q.eq("projectId", file.projectId).eq("parentId", file.parentId),
      )
      .collect();
    const existing = siblings.find(
      (sibling) =>
        sibling.name === args.newName &&
        sibling._id !== args.fileId &&
        sibling.type === file.type,
    );
    if (existing) {
      throw new Error(
        `A ${file.type} with this name "${args.newName}" already exists in this location`,
      );
    }
    await ctx.db.patch(args.fileId, {
      name: args.newName,
      updatedAt: Date.now(),
    });
    return args.fileId;
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
    const file = await ctx.db.get(args.fileId);
    if (!file) {
      throw new Error("File not found");
    }
    if (file.projectId !== args.projectId) {
      throw new Error("File does not belong to this project");
    }

    const deleteRecursive = async (fileId: typeof args.fileId) => {
      const item = await ctx.db.get(fileId);
      if (!item) {
        return;
      }

      if (item.type === "folder") {
        const children = await ctx.db
          .query("files")
          .withIndex("by_project_parent", (q) =>
            q.eq("projectId", item.projectId).eq("parentId", fileId),
          )
          .collect();
        for (const child of children) {
          await deleteRecursive(child._id);
        }
      }
      if (item.storageId) {
        await ctx.storage.delete(item.storageId);
      }
      await ctx.db.delete(fileId);
    };
    await deleteRecursive(args.fileId);
    return args.fileId;
  },
});
export const cleanup = mutation({
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

    for (const file of files) {
      // Delete storage file if it exists
      if (file.storageId) {
        await ctx.storage.delete(file.storageId);
      }

      await ctx.db.delete(file._id);
    }

    return { deleted: files.length };
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

    const files = await ctx.db
      .query("files")
      .withIndex("by_project_parent", (q) =>
        q.eq("projectId", args.projectId).eq("parentId", args.parentId),
      )
      .collect();

    const existing = files.find(
      (file) => file.name === args.name && file.type === "file",
    );

    if (existing) {
      throw new Error("File already exists");
    }

    const fileId = await ctx.db.insert("files", {
      projectId: args.projectId,
      name: args.name,
      type: "file",
      storageId: args.storageId,
      parentId: args.parentId,
      updatedAt: Date.now(),
    });

    return fileId;
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
