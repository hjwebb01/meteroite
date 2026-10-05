/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { createFileAtPath } from "./lib/project-files";
import schema from "./schema";
import { buildFileTree } from "../src/features/preview/utils/file-tree";

const modules = import.meta.glob("./**/*.ts");
const callers = ["editor", "agent", "import"] as const;
type Caller = (typeof callers)[number];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function setup(moduleMap = modules) {
  const t = convexTest(schema, moduleMap);
  const owner = t.withIdentity({ subject: "owner" });
  const other = t.withIdentity({ subject: "other" });
  const projectId = await owner.mutation(api.projects.create, {
    name: "project",
  });
  const otherProjectId = await other.mutation(api.projects.create, {
    name: "other",
  });
  return { t, owner, other, projectId, otherProjectId };
}

type Workspace = Awaited<ReturnType<typeof setup>>;
async function files(w: Workspace) {
  return w.owner.query(api.files.getFiles, { projectId: w.projectId });
}
async function create(w: Workspace, caller: Caller, name: string) {
  if (caller === "editor") {
    await w.owner.mutation(api.files.createFile, {
      projectId: w.projectId,
      name,
      content: "original",
    });
  } else if (caller === "agent") {
    const [result] = await w.t.mutation(
      internal.agentFiles.agentCreateFilesByPaths,
      {
        projectId: w.projectId,
        files: [{ path: name, content: "original" }],
      },
    );
    expect(result.error).toBeUndefined();
  } else {
    await w.t.mutation(internal.importExport.createSingleFile, {
      projectId: w.projectId,
      name,
      content: "original",
    });
  }
  return (await files(w)).find((f) => f.name === name)!;
}
async function resetTimestamp(w: Workspace) {
  await w.t.run((ctx) =>
    ctx.db.patch("projects", w.projectId, { updatedAt: 1 }),
  );
}
async function projectTimestamp(w: Workspace) {
  return (await w.owner.query(api.projects.getById, { id: w.projectId }))
    .updatedAt;
}

// These tests cross the existing mutation interfaces used by each real caller.
describe("shared Project file rules", () => {
  test.each(callers)("%s creation updates Project recency", async (caller) => {
    const w = await setup();
    await resetTimestamp(w);
    vi.spyOn(Date, "now").mockReturnValue(2000);
    const file = await create(w, caller, "a.txt");
    expect(file.updatedAt).toBe(2000);
    expect(await projectTimestamp(w)).toBe(2000);
  });

  test.each(callers)(
    "%s cannot create a file at a folder's name",
    async (caller) => {
      const w = await setup();
      await w.owner.mutation(api.files.createFolder, {
        projectId: w.projectId,
        name: "src",
      });
      const args = { projectId: w.projectId, name: "src", content: "" };
      if (caller === "agent") {
        const [result] = await w.t.mutation(
          internal.agentFiles.agentCreateFilesByPaths,
          {
            projectId: w.projectId,
            files: [{ path: "src", content: "" }],
          },
        );
        expect(result.error).toMatch(/already exists/);
      } else {
        await expect(
          caller === "editor"
            ? w.owner.mutation(api.files.createFile, args)
            : w.t.mutation(internal.importExport.createSingleFile, {
                ...args,
              }),
        ).rejects.toThrow(/already exists/);
      }
      expect(await files(w)).toHaveLength(1);
    },
  );

  test.each(["", "  ", ".", "..", "a/b", "a\\b"])(
    "import rejects invalid name %j",
    async (name) => {
      const w = await setup();
      await expect(
        w.t.mutation(internal.importExport.createSingleFile, {
          projectId: w.projectId,
          name,
          content: "",
        }),
      ).rejects.toThrow(/Name cannot/);
      expect(await files(w)).toHaveLength(0);
    },
  );

  test.each(["createSingleFile", "createFolder", "createBinaryFile"] as const)(
    "import %s rejects another Project's parent",
    async (operation) => {
      const w = await setup();
      const parentId = await w.t.mutation(internal.importExport.createFolder, {
        projectId: w.otherProjectId,
        name: "private",
      });
      const args = {
        projectId: w.projectId,
        parentId,
        name: "child",
      };
      const storageId = await w.t.run((ctx) =>
        ctx.storage.store(new Blob(["bytes"])),
      );
      await expect(
        operation === "createSingleFile"
          ? w.t.mutation(internal.importExport.createSingleFile, {
              ...args,
              content: "",
            })
          : operation === "createFolder"
            ? w.t.mutation(internal.importExport.createFolder, args)
            : w.t.mutation(internal.importExport.createBinaryFile, {
                ...args,
                storageId,
              }),
      ).rejects.toThrow(/Parent folder not found/);
      expect(await files(w)).toHaveLength(0);
    },
  );

  test("import rejects a file as parent and verifies the Project exists", async () => {
    const w = await setup();
    const file = await create(w, "import", "a.txt");
    await expect(
      w.t.mutation(internal.importExport.createFolder, {
        projectId: w.projectId,
        parentId: file._id,
        name: "child",
      }),
    ).rejects.toThrow(/Parent must be a folder/);
    await w.t.run((ctx) => ctx.db.delete("projects", w.otherProjectId));
    await expect(
      w.t.mutation(internal.importExport.createSingleFile, {
        projectId: w.otherProjectId,
        name: "orphan",
        content: "",
      }),
    ).rejects.toThrow(/Project not found/);
  });

  test.each(["editor", "agent"] as const)(
    "%s rename enforces names and cross-type collisions",
    async (caller) => {
      const w = await setup();
      const file = await create(w, "import", "a.txt");
      await w.owner.mutation(api.files.createFolder, {
        projectId: w.projectId,
        name: "src",
      });
      for (const newName of ["src", "a/b", "..", " "]) {
        await expect(
          caller === "editor"
            ? w.owner.mutation(api.files.renameFile, { id: file._id, newName })
            : w.t.mutation(internal.agentFiles.renameFile, {
                projectId: w.projectId,
                fileId: file._id,
                newName,
              }),
        ).rejects.toThrow();
      }
      await resetTimestamp(w);
      vi.spyOn(Date, "now").mockReturnValue(3000);
      await (caller === "editor"
        ? w.owner.mutation(api.files.renameFile, {
            id: file._id,
            newName: "renamed.txt",
          })
        : w.t.mutation(internal.agentFiles.renameFile, {
            projectId: w.projectId,
            fileId: file._id,
            newName: "renamed.txt",
          }));
      expect((await files(w)).find((f) => f._id === file._id)?.name).toBe(
        "renamed.txt",
      );
      expect(await projectTimestamp(w)).toBe(3000);
    },
  );

  test.each(["editor", "agent"] as const)(
    "%s only updates text files",
    async (caller) => {
      const w = await setup();
      const text = await create(w, "import", "a.txt");
      const folderId = await w.t.mutation(internal.importExport.createFolder, {
        projectId: w.projectId,
        name: "folder",
      });
      const storageId = await w.t.run((ctx) =>
        ctx.storage.store(new Blob(["binary"])),
      );
      const binaryId = await w.t.mutation(
        internal.importExport.createBinaryFile,
        {
          projectId: w.projectId,
          name: "image",
          storageId,
        },
      );
      const update = (fileId: Id<"files">) =>
        caller === "editor"
          ? w.owner.mutation(api.files.updateFile, {
              id: fileId,
              content: "changed",
            })
          : w.t.mutation(internal.agentFiles.updateFile, {
              projectId: w.projectId,
              fileId,
              content: "changed",
            });
      await resetTimestamp(w);
      for (const id of [folderId, binaryId])
        await expect(update(id)).rejects.toThrow(/Only text files/);
      expect(await projectTimestamp(w)).toBe(1);
      expect(
        (await files(w)).find((f) => f._id === binaryId)?.content,
      ).toBeUndefined();
      vi.spyOn(Date, "now").mockReturnValue(4000);
      await update(text._id);
      expect((await files(w)).find((f) => f._id === text._id)?.content).toBe(
        "changed",
      );
      expect(await projectTimestamp(w)).toBe(4000);
    },
  );

  test("agent writes reject an existing identifier from another Project", async () => {
    const w = await setup();
    const foreignId = await w.t.mutation(
      internal.importExport.createSingleFile,
      {
        projectId: w.otherProjectId,
        name: "private",
        content: "secret",
      },
    );
    const args = { projectId: w.projectId, fileId: foreignId };
    await expect(
      w.t.mutation(internal.agentFiles.updateFile, {
        ...args,
        content: "changed",
      }),
    ).rejects.toThrow(/does not belong/);
    await expect(
      w.t.mutation(internal.agentFiles.renameFile, {
        ...args,
        newName: "changed",
      }),
    ).rejects.toThrow(/does not belong/);
    await expect(
      w.t.mutation(internal.agentFiles.deleteFile, args),
    ).rejects.toThrow(/does not belong/);
    expect(
      (
        await w.other.query(api.files.getFiles, { projectId: w.otherProjectId })
      )[0].content,
    ).toBe("secret");
  });

  test("adapters retain owner and internal-key checks", async () => {
    const w = await setup();
    const file = await create(w, "editor", "a.txt");
    await expect(
      w.other.mutation(api.files.renameFile, {
        id: file._id,
        newName: "stolen",
      }),
    ).rejects.toThrow(/Unauthorized/);
    await expect(
      w.other.mutation(api.files.updateFile, {
        id: file._id,
        content: "stolen",
      }),
    ).rejects.toThrow(/Unauthorized/);
    await expect(
      w.other.mutation(api.files.deleteFile, { id: file._id }),
    ).rejects.toThrow(/Unauthorized/);
  });
});

describe("batch creation and Folder paths", () => {
  test("a batch keeps successful entries, rejects duplicates, and creates parents", async () => {
    const w = await setup();
    const results = await w.t.mutation(
      internal.agentFiles.agentCreateFilesByPaths,
      {
        projectId: w.projectId,
        files: [
          { path: "src/a.ts", content: "a" },
          { path: "new/ /bad.ts", content: "bad" },
          { path: "src/a.ts", content: "duplicate" },
          { path: "src/b.ts", content: "b" },
        ],
      },
    );
    expect(results.map((r) => !!r.fileId)).toEqual([true, false, false, true]);
    const records = await files(w);
    expect(records.map((f) => f.name).sort()).toEqual(["a.ts", "b.ts", "src"]);
    expect(records.find((f) => f.name === "a.ts")?.content).toBe("a");
    expect(await projectTimestamp(w)).toBeGreaterThan(1);
  });

  test("an error after writes rolls back that entry and its parent Folders", async () => {
    const agentFiles = await import("./agentFiles");
    // A controllable internal mutation adapter fails after performing real writes.
    const faultingModules = {
      ...modules,
      "./agentFiles.ts": async () => ({
        ...agentFiles,
        createBatchFile: internalMutation(
          async (
            ctx,
            args: {
              projectId: Id<"projects">;
              location: { path: string };
              content: string;
            },
          ) => {
            const id = await createFileAtPath(ctx, {
              projectId: args.projectId,
              path: args.location.path,
              content: args.content,
            });
            if (args.location.path === "failed/nested/a.ts")
              throw new Error("Write failed after creating the entry");
            return id;
          },
        ),
      }),
    };
    const w = await setup(faultingModules);
    const results = await w.t.mutation(
      internal.agentFiles.agentCreateFilesByPaths,
      {
        projectId: w.projectId,
        files: [
          { path: "before.ts", content: "before" },
          { path: "failed/nested/a.ts", content: "failed" },
          { path: "after.ts", content: "after" },
        ],
      },
    );
    expect(results[1].error).toMatch(/Write failed/);
    expect(results[0].fileId).toBeDefined();
    expect(results[2].fileId).toBeDefined();
    expect((await files(w)).map((f) => f.name).sort()).toEqual([
      "after.ts",
      "before.ts",
    ]);
  });

  test("legacy batches detect duplicates inserted earlier in the same batch", async () => {
    const w = await setup();
    const result = await w.t.mutation(internal.agentFiles.createFiles, {
      projectId: w.projectId,
      files: [
        { name: "a", content: "first" },
        { name: "a", content: "second" },
      ],
    });
    expect(result[0].error).toBeUndefined();
    expect(result[1].error).toMatch(/already exists/);
    expect(result[1].fileId).toBe(result[0].fileId);
    expect(await files(w)).toHaveLength(1);
  });

  test("Folder paths preserve normalization, reuse Folders, and only touch changed Projects", async () => {
    const w = await setup();
    await resetTimestamp(w);
    vi.spyOn(Date, "now").mockReturnValue(5000);
    const first = await w.t.mutation(
      internal.agentFiles.agentEnsureFolderPath,
      {
        projectId: w.projectId,
        path: " src\\nested// ",
      },
    );
    expect(first.path).toBe("src/nested");
    expect(first.createdNewFolders).toBe(true);
    expect(await projectTimestamp(w)).toBe(5000);
    await resetTimestamp(w);
    const again = await w.t.mutation(
      internal.agentFiles.agentEnsureFolderPath,
      {
        projectId: w.projectId,
        path: "src/nested",
      },
    );
    expect(again.folderId).toBe(first.folderId);
    expect(again.createdNewFolders).toBe(false);
    expect(await projectTimestamp(w)).toBe(1);
    for (const path of ["/root", "src/../a", "src/ /a"]) {
      await expect(
        w.t.mutation(internal.agentFiles.agentEnsureFolderPath, {
          projectId: w.projectId,
          path,
        }),
      ).rejects.toThrow();
    }
    expect(await files(w)).toHaveLength(2);
  });
});

describe("deletion and import cleanup", () => {
  test("agent batch deletion tolerates ancestor, descendant, duplicate, and repeated IDs", async () => {
    const w = await setup();
    const folderId = await w.t.mutation(internal.importExport.createFolder, {
      projectId: w.projectId,
      name: "folder",
    });
    const childId = await w.t.mutation(internal.importExport.createSingleFile, {
      projectId: w.projectId,
      parentId: folderId,
      name: "a",
      content: "a",
    });
    const request = {
      projectId: w.projectId,
      rawIds: [folderId, childId, childId],
    };
    expect(
      await w.t.mutation(internal.agentFiles.agentDeleteFiles, request),
    ).toHaveLength(3);
    expect(await files(w)).toEqual([]);
    await resetTimestamp(w);
    const repeated = await w.t.mutation(
      internal.agentFiles.agentDeleteFiles,
      request,
    );
    expect(repeated.every((result) => result.alreadyMissing)).toBe(true);
    expect(await projectTimestamp(w)).toBe(1);
  });

  test("agent batch deletion validates malformed and foreign IDs before any deletion", async () => {
    const w = await setup();
    const keep = await create(w, "editor", "keep.txt");
    const foreignId = await w.t.mutation(
      internal.importExport.createSingleFile,
      {
        projectId: w.otherProjectId,
        name: "foreign",
        content: "foreign",
      },
    );
    for (const invalid of ["not-an-id", foreignId, w.projectId]) {
      await expect(
        w.t.mutation(internal.agentFiles.agentDeleteFiles, {
          projectId: w.projectId,
          rawIds: [keep._id, invalid],
        }),
      ).rejects.toThrow();
      expect((await files(w)).map((f) => f._id)).toEqual([keep._id]);
    }
  });

  test.each(["editor", "agent"] as const)(
    "%s deletes descendants and binary storage, then tolerates repeats",
    async (caller) => {
      const w = await setup();
      const rootId = await w.t.mutation(internal.importExport.createFolder, {
        projectId: w.projectId,
        name: "root",
      });
      const childId = await w.t.mutation(internal.importExport.createFolder, {
        projectId: w.projectId,
        parentId: rootId,
        name: "nested",
      });
      const storageId = await w.t.run((ctx) =>
        ctx.storage.store(new Blob(["binary"])),
      );
      const binaryId = await w.t.mutation(
        internal.importExport.createBinaryFile,
        {
          projectId: w.projectId,
          parentId: childId,
          name: "image",
          storageId,
        },
      );
      await create(w, "editor", "keep.txt");
      await w.t.mutation(internal.importExport.createSingleFile, {
        projectId: w.otherProjectId,
        name: "foreign.txt",
        content: "keep",
      });
      const remove = (fileId: Id<"files">) =>
        caller === "editor"
          ? w.owner.mutation(api.files.deleteFile, { id: fileId })
          : w.t.mutation(internal.agentFiles.deleteFile, {
              projectId: w.projectId,
              fileId,
            });
      await resetTimestamp(w);
      vi.spyOn(Date, "now").mockReturnValue(6000);
      await remove(rootId);
      expect((await files(w)).map((f) => f.name)).toEqual(["keep.txt"]);
      expect(await w.t.run((ctx) => ctx.storage.get(storageId))).toBeNull();
      expect(await projectTimestamp(w)).toBe(6000);
      await resetTimestamp(w);
      await remove(rootId);
      await remove(binaryId);
      expect(await projectTimestamp(w)).toBe(1);
      expect(
        await w.other.query(api.files.getFiles, {
          projectId: w.otherProjectId,
        }),
      ).toHaveLength(1);
    },
  );

  test("import cleanup removes only its Project's records and storage", async () => {
    const w = await setup();
    const storageId = await w.t.run((ctx) =>
      ctx.storage.store(new Blob(["binary"])),
    );
    await w.t.mutation(internal.importExport.createBinaryFile, {
      projectId: w.projectId,
      name: "image",
      storageId,
    });
    await create(w, "editor", "a.txt");
    await w.t.mutation(internal.importExport.createSingleFile, {
      projectId: w.otherProjectId,
      name: "foreign",
      content: "keep",
    });
    await resetTimestamp(w);
    vi.spyOn(Date, "now").mockReturnValue(7000);
    expect(
      await w.t.mutation(internal.importExport.cleanup, {
        projectId: w.projectId,
      }),
    ).toEqual({ deleted: 2 });
    expect(await files(w)).toEqual([]);
    expect(await w.t.run((ctx) => ctx.storage.get(storageId))).toBeNull();
    expect(await projectTimestamp(w)).toBe(7000);
    expect(
      await w.other.query(api.files.getFiles, { projectId: w.otherProjectId }),
    ).toHaveLength(1);
  });
});

describe("project path consumers", () => {
  test("keeps agent paths, preview paths, and breadcrumbs consistent for orphans", async () => {
    const w = await setup();
    const { rootId, folderId, fileId } = await w.t.run(async (ctx) => {
      const rootId = await ctx.db.insert("files", {
        projectId: w.projectId, updatedAt: 1, name: "root", type: "folder",
      });
      const folderId = await ctx.db.insert("files", {
        projectId: w.projectId, updatedAt: 1, name: "src", type: "folder", parentId: rootId,
      });
      const fileId = await ctx.db.insert("files", {
        projectId: w.projectId, updatedAt: 1, name: "app.ts", type: "file",
        parentId: folderId, content: "source",
      });
      return { rootId, folderId, fileId };
    });
    expect(await w.owner.query(api.files.getFilePath, { id: fileId })).toEqual([
      { _id: rootId, name: "root" },
      { _id: folderId, name: "src" },
      { _id: fileId, name: "app.ts" },
    ]);
    await w.t.run((ctx) => ctx.db.delete(rootId));
    expect(await w.owner.query(api.files.getFilePath, { id: fileId })).toEqual([
      { _id: folderId, name: "src" },
      { _id: fileId, name: "app.ts" },
    ]);
    const paths = await w.t.query(internal.agentFiles.getProjectFilesWithPaths, {
      projectId: w.projectId,
    });
    expect(paths.find((file) => file.id === fileId)?.path).toBe("src/app.ts");
    expect(buildFileTree(await files(w))).toEqual({
      src: { directory: { "app.ts": { file: { contents: "source" } } } },
    });
  });
});
