import { MAX_AGENT_CREATE_FILES_PER_MUTATION } from "./agentLimits";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { projectPaths } from "./lib/project-paths";
import * as projectFiles from "./lib/project-files";
import { normalizeWorkspacePathToSegments } from "./lib/project-files";
import { internalMutation, internalQuery } from "./_generated/server";
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
  rows: v.array(v.array(v.union(v.string(), v.null()))),
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

// "ListFiles" tool used by the coding agent
export const getProjectFiles = internalQuery({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("files")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

/** Same as getProjectFiles but each item includes a resolved workspace-relative `path`. */
export const getProjectFilesWithPaths = internalQuery({
  args: {
    projectId: v.id("projects"),
  },
  returns: v.array(projectFileWithPathRow),
  handler: async (ctx, args) => {
    const files = await ctx.db
      .query("files")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const { pathById } = projectPaths(files);

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
export const agentListProjectFiles = internalQuery({
  args: {
    projectId: v.id("projects"),
    format: v.optional(v.union(v.literal("full"), v.literal("compact"))),
    pathPrefix: v.optional(v.string()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.number()),
  },
  returns: v.union(v.array(projectFileWithPathRow), agentListCompactPayload),
  handler: async (ctx, args) => {
    const format = args.format ?? "compact";
    const limit = Math.min(Math.max(args.limit ?? 500, 1), 5000);
    const cursor = Math.max(args.cursor ?? 0, 0);
    const prefix = args.pathPrefix ?? "";

    const files = await ctx.db
      .query("files")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const { pathById } = projectPaths(files);

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
export const agentReadFiles = internalQuery({
  args: {
    projectId: v.id("projects"),
    paths: v.optional(v.array(v.string())),
    fileIds: v.optional(v.array(v.string())),
    maxChars: v.optional(v.number()),
    lineStart: v.optional(v.number()),
    lineEnd: v.optional(v.number()),
  },
  returns: v.array(agentReadFileResultRow),
  handler: async (ctx, args) => {
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
    const { pathById, fileByPath } = projectPaths(files);

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
export const agentResolveFileIdsInProject = internalQuery({
  args: {
    projectId: v.id("projects"),
    rawIds: v.array(v.string()),
  },
  returns: v.array(agentResolveFileIdRow),
  handler: async (ctx, args) => {
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
export const getFileById = internalQuery({
  args: {
    fileId: v.id("files"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.fileId);
  },
});

// "UpdateFile" tool used by the coding agent
export const updateFile = internalMutation({
  args: {
    projectId: v.id("projects"),
    fileId: v.id("files"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
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

// "CreateFiles" tool used by the coding agent (bulk create files)
export const createFiles = internalMutation({
  args: {
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
    const results: { name: string; fileId: string; error?: string }[] = [];
    for (const file of args.files) {
      try {
        const fileId: Id<"files"> = await ctx.runMutation(
          internal.agentFiles.createBatchFile,
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

/**
 * Coding agent: ensure a folder exists at a workspace-relative path (creates missing segments).
 * Prefer this over createFolder + parent IDs.
 */
export const agentEnsureFolderPath = internalMutation({
  args: {
    projectId: v.id("projects"),
    path: v.string(),
  },
  returns: agentEnsureFolderPathResult,
  handler: async (ctx, args) => {
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
export const agentCreateFilesByPaths = internalMutation({
  args: {
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
          internal.agentFiles.createBatchFile,
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
export const renameFile = internalMutation({
  args: {
    projectId: v.id("projects"),
    fileId: v.id("files"),
    newName: v.string(),
  },
  handler: async (ctx, args) => {
    return projectFiles.renameEntry(ctx, {
      projectId: args.projectId,
      fileId: args.fileId,
      newName: args.newName,
    });
  },
});

// "DeleteFile" tool used by the coding agent
export const deleteFile = internalMutation({
  args: {
    projectId: v.id("projects"),
    fileId: v.id("files"),
  },
  handler: async (ctx, args) => {
    return projectFiles.deleteEntry(ctx, {
      projectId: args.projectId,
      fileId: args.fileId,
    });
  },
});

export const agentDeleteFiles = internalMutation({
  args: {
    projectId: v.id("projects"),
    rawIds: v.array(v.string()),
  },
  returns: v.array(
    v.object({
      fileId: v.id("files"),
      name: v.optional(v.string()),
      type: v.optional(v.union(v.literal("file"), v.literal("folder"))),
      alreadyMissing: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    return projectFiles.deleteEntries(ctx, {
      projectId: args.projectId,
      rawIds: args.rawIds,
    });
  },
});
