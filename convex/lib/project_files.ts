import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

type Location = {
  projectId: Id<"projects">;
  parentId?: Id<"files">;
  name: string;
};

type Contents =
  | { content: string; storageId?: never }
  | { storageId: Id<"_storage">; content?: never };

function validateName(name: string): void {
  if (!name.trim()) {
    throw new Error("Name cannot be empty");
  }
  if (name === "." || name === ".." || /[/\\]/.test(name)) {
    throw new Error("Name cannot be '.' or '..' or contain slashes");
  }
}

export function normalizeWorkspacePathToSegments(raw: string): string[] {
  const trimmed = raw.trim().replace(/\\/g, "/");
  if (!trimmed) {
    throw new Error("Path cannot be empty");
  }
  if (trimmed.startsWith("/")) {
    throw new Error("Path must be workspace-relative (no leading slash)");
  }
  const segments = trimmed.split("/").filter(Boolean);
  for (const segment of segments) {
    validateName(segment);
  }
  return segments;
}

async function requireProject(ctx: MutationCtx, projectId: Id<"projects">) {
  const project = await ctx.db.get("projects", projectId);
  if (!project) {
    throw new Error("Project not found");
  }
}

async function siblingsAt(ctx: MutationCtx, location: Omit<Location, "name">) {
  if (location.parentId) {
    const parent = await ctx.db.get("files", location.parentId);
    if (!parent || parent.projectId !== location.projectId) {
      throw new Error("Parent folder not found");
    }
    if (parent.type !== "folder") {
      throw new Error("Parent must be a folder");
    }
  }
  return ctx.db
    .query("files")
    .withIndex("by_project_parent", (q) =>
      q.eq("projectId", location.projectId).eq("parentId", location.parentId),
    )
    .collect();
}

function assertNameAvailable(
  siblings: Doc<"files">[],
  name: string,
  excludeId?: Id<"files">,
): void {
  if (
    siblings.some((entry) => entry.name === name && entry._id !== excludeId)
  ) {
    throw new Error("An item with this name already exists in this location");
  }
}

async function touchProject(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  now: number,
) {
  await ctx.db.patch("projects", projectId, { updatedAt: now });
}

export async function createFile(ctx: MutationCtx, args: Location & Contents) {
  await requireProject(ctx, args.projectId);
  validateName(args.name);
  assertNameAvailable(await siblingsAt(ctx, args), args.name);
  const now = Date.now();
  const fileId = await ctx.db.insert("files", {
    projectId: args.projectId,
    parentId: args.parentId,
    name: args.name,
    content: args.content,
    storageId: args.storageId,
    type: "file",
    updatedAt: now,
  });
  await touchProject(ctx, args.projectId, now);
  return fileId;
}

export async function createFolder(ctx: MutationCtx, args: Location) {
  await requireProject(ctx, args.projectId);
  validateName(args.name);
  assertNameAvailable(await siblingsAt(ctx, args), args.name);
  const now = Date.now();
  const folderId = await ctx.db.insert("files", {
    projectId: args.projectId,
    parentId: args.parentId,
    name: args.name,
    type: "folder",
    updatedAt: now,
  });
  await touchProject(ctx, args.projectId, now);
  return folderId;
}

async function ensureFolders(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  segments: string[],
) {
  let parentId: Id<"files"> | undefined;
  let createdNewFolders = false;
  for (const name of segments) {
    const siblings = await siblingsAt(ctx, { projectId, parentId });
    const matches = siblings.filter((entry) => entry.name === name);
    if (matches.length > 1) {
      throw new Error(`Invalid file tree: multiple items named "${name}"`);
    }
    const existing = matches[0];
    if (existing) {
      if (existing.type !== "folder") {
        throw new Error(
          `Cannot create folder "${name}": a file exists at that path`,
        );
      }
      parentId = existing._id;
    } else {
      parentId = await ctx.db.insert("files", {
        projectId,
        parentId,
        name,
        type: "folder",
        updatedAt: Date.now(),
      });
      createdNewFolders = true;
    }
  }
  return { parentId, createdNewFolders };
}

export async function ensureFolderPath(
  ctx: MutationCtx,
  args: { projectId: Id<"projects">; path: string },
) {
  await requireProject(ctx, args.projectId);
  const segments = normalizeWorkspacePathToSegments(args.path);
  const result = await ensureFolders(ctx, args.projectId, segments);
  if (result.createdNewFolders) {
    await touchProject(ctx, args.projectId, Date.now());
  }
  return {
    folderId: result.parentId!,
    path: segments.join("/"),
    createdNewFolders: result.createdNewFolders,
  };
}

// Batch callers use a nested mutation so an error also rolls back new folders.
export async function createFileAtPath(
  ctx: MutationCtx,
  args: { projectId: Id<"projects">; path: string; content: string },
) {
  await requireProject(ctx, args.projectId);
  const segments = normalizeWorkspacePathToSegments(args.path);
  const name = segments.pop()!;
  const { parentId } = await ensureFolders(ctx, args.projectId, segments);
  return createFile(ctx, {
    projectId: args.projectId,
    parentId,
    name,
    content: args.content,
  });
}

async function getEntry(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  fileId: Id<"files">,
) {
  await requireProject(ctx, projectId);
  const file = await ctx.db.get("files", fileId);
  if (file && file.projectId !== projectId) {
    throw new Error("File does not belong to this project");
  }
  return file;
}

export async function updateTextFile(
  ctx: MutationCtx,
  args: { projectId: Id<"projects">; fileId: Id<"files">; content: string },
) {
  const file = await getEntry(ctx, args.projectId, args.fileId);
  if (!file) {
    throw new Error("File not found");
  }
  if (file.type === "folder" || file.storageId) {
    throw new Error("Only text files can be updated");
  }
  const now = Date.now();
  await ctx.db.patch("files", args.fileId, {
    content: args.content,
    updatedAt: now,
  });
  await touchProject(ctx, args.projectId, now);
  return args.fileId;
}

export async function renameEntry(
  ctx: MutationCtx,
  args: { projectId: Id<"projects">; fileId: Id<"files">; newName: string },
) {
  const file = await getEntry(ctx, args.projectId, args.fileId);
  if (!file) {
    throw new Error("File not found");
  }
  validateName(args.newName);
  assertNameAvailable(await siblingsAt(ctx, file), args.newName, args.fileId);
  const now = Date.now();
  await ctx.db.patch("files", args.fileId, {
    name: args.newName,
    updatedAt: now,
  });
  await touchProject(ctx, args.projectId, now);
  return args.fileId;
}

async function removeEntries(ctx: MutationCtx, entries: Doc<"files">[]) {
  const storageIds = new Set(
    entries.flatMap((entry) => (entry.storageId ? [entry.storageId] : [])),
  );
  for (const storageId of storageIds) {
    await ctx.storage.delete(storageId);
  }
  for (const entry of entries) {
    await ctx.db.delete("files", entry._id);
  }
}

export async function deleteEntry(
  ctx: MutationCtx,
  args: { projectId: Id<"projects">; fileId: Id<"files"> },
) {
  const root = await getEntry(ctx, args.projectId, args.fileId);
  if (!root) {
    return args.fileId;
  }
  const pending = [root];
  const entries: Doc<"files">[] = [];
  const seen = new Set<Id<"files">>();
  while (pending.length) {
    const entry = pending.pop()!;
    if (seen.has(entry._id)) {
      continue;
    }
    seen.add(entry._id);
    entries.push(entry);
    if (entry.type === "folder") {
      pending.push(
        ...(await ctx.db
          .query("files")
          .withIndex("by_project_parent", (q) =>
            q.eq("projectId", args.projectId).eq("parentId", entry._id),
          )
          .collect()),
      );
    }
  }
  await removeEntries(ctx, entries);
  await touchProject(ctx, args.projectId, Date.now());
  return args.fileId;
}

export async function clearProjectFiles(
  ctx: MutationCtx,
  projectId: Id<"projects">,
) {
  await requireProject(ctx, projectId);
  const files = await ctx.db
    .query("files")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  await removeEntries(ctx, files);
  if (files.length) {
    await touchProject(ctx, projectId, Date.now());
  }
  return { deleted: files.length };
}

export async function deleteEntries(
  ctx: MutationCtx,
  args: { projectId: Id<"projects">; rawIds: string[] },
) {
  await requireProject(ctx, args.projectId);
  const resolved = [];
  // Validate the entire request before removing anything. Missing persisted IDs
  // are valid retries; malformed and wrong-Project IDs are errors.
  for (const raw of args.rawIds) {
    const fileId = ctx.db.normalizeId("files", raw);
    if (!fileId) {
      throw new Error(`Invalid file ID: "${raw}"`);
    }
    const file = await getEntry(ctx, args.projectId, fileId);
    resolved.push({ fileId, file });
  }
  const results = [];
  for (const { fileId, file } of resolved) {
    await deleteEntry(ctx, { projectId: args.projectId, fileId });
    results.push({
      fileId,
      name: file?.name,
      type: file?.type,
      alreadyMissing: !file,
    });
  }
  return results;
}

/** Resolve an existing entry without creating parents or leaving the Project. */
export async function findEntryAtPath(
  ctx: MutationCtx,
  args: { projectId: Id<"projects">; path: string },
) {
  await requireProject(ctx, args.projectId);
  const segments = normalizeWorkspacePathToSegments(args.path);
  let parentId: Id<"files"> | undefined;
  let entry: Doc<"files"> | undefined;
  for (let i = 0; i < segments.length; i++) {
    const matches = (
      await siblingsAt(ctx, { projectId: args.projectId, parentId })
    ).filter((file) => file.name === segments[i]);
    if (matches.length > 1) {
      throw new Error(
        `Ambiguous path "${args.path}": multiple items named "${segments[i]}"`,
      );
    }
    entry = matches[0];
    if (!entry) return undefined;
    if (i < segments.length - 1 && entry.type !== "folder") {
      throw new Error(`Path "${args.path}" traverses a file`);
    }
    parentId = entry._id;
  }
  return entry;
}

export async function requireEntryAtPath(
  ctx: MutationCtx,
  args: { projectId: Id<"projects">; path: string },
) {
  const file = await findEntryAtPath(ctx, args);
  if (!file) throw new Error(`File or folder not found at path "${args.path}"`);
  return file;
}
