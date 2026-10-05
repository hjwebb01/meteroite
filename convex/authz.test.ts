/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const internalKey = "test-internal-key";

beforeEach(() => {
  vi.stubEnv("METEROITE_CONVEX_INTERNAL_KEY", internalKey);
});

const setup = async () => {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice" });
  const bob = t.withIdentity({ subject: "bob" });
  const aliceProject = await alice.mutation(api.projects.create, {
    name: "alice-project",
  });
  const bobProject = await bob.mutation(api.projects.create, {
    name: "bob-project",
  });
  const aliceConversation = await alice.mutation(api.conversations.create, {
    projectId: aliceProject,
    title: "chat",
  });
  return { t, alice, bob, aliceProject, bobProject, aliceConversation };
};

describe("files", () => {
  test("a parent folder from another project is rejected", async () => {
    const { t, bob, aliceProject, bobProject } = await setup();
    const aliceFolder = await t.run((ctx) =>
      ctx.db.insert("files", {
        projectId: aliceProject,
        name: "secret-folder",
        type: "folder",
        updatedAt: Date.now(),
      }),
    );

    await expect(
      bob.mutation(api.files.createFile, {
        projectId: bobProject,
        parentId: aliceFolder,
        name: "probe.txt",
        content: "",
      }),
    ).rejects.toThrow(/Parent folder not found/);
    await expect(
      bob.mutation(api.files.createFolder, {
        projectId: bobProject,
        parentId: aliceFolder,
        name: "probe",
      }),
    ).rejects.toThrow(/Parent folder not found/);
  });

  test("a file cannot be used as a parent", async () => {
    const { alice, aliceProject } = await setup();
    await alice.mutation(api.files.createFile, {
      projectId: aliceProject,
      name: "a.txt",
      content: "",
    });
    const [file] = await alice.query(api.files.getFiles, {
      projectId: aliceProject,
    });

    await expect(
      alice.mutation(api.files.createFile, {
        projectId: aliceProject,
        parentId: file._id,
        name: "b.txt",
        content: "",
      }),
    ).rejects.toThrow(/Parent must be a folder/);
  });

  test.each(["", "  ", ".", "..", "a/b", "a\\b"])(
    "rejects invalid name %j",
    async (name) => {
      const { alice, aliceProject } = await setup();
      await expect(
        alice.mutation(api.files.createFile, {
          projectId: aliceProject,
          name,
          content: "",
        }),
      ).rejects.toThrow(/Name cannot/);
    },
  );

  test("files and folders cannot share a name in the same folder", async () => {
    const { alice, aliceProject } = await setup();
    await alice.mutation(api.files.createFolder, {
      projectId: aliceProject,
      name: "src",
    });

    await expect(
      alice.mutation(api.files.createFile, {
        projectId: aliceProject,
        name: "src",
        content: "",
      }),
    ).rejects.toThrow(/already exists/);

    await alice.mutation(api.files.createFile, {
      projectId: aliceProject,
      name: "index.ts",
      content: "",
    });
    const files = await alice.query(api.files.getFiles, {
      projectId: aliceProject,
    });
    const indexFile = files.find((f) => f.name === "index.ts")!;
    await expect(
      alice.mutation(api.files.renameFile, { id: indexFile._id, newName: "src" }),
    ).rejects.toThrow(/already exists/);
  });
});
