// @vitest-environment node
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import type { Doc } from "../../../../convex/_generated/dataModel";
import { createFileSync } from "./file-sync";

const file = (
  _id: string,
  name: string,
  content = "source",
  parentId?: string,
) => ({ _id, name, content, parentId, type: "file" }) as Doc<"files">;
const folder = (_id: string, name: string, parentId?: string) =>
  ({ _id, name, parentId, type: "folder" }) as Doc<"files">;
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function setup(initial: Doc<"files">[]) {
  const root = await mkdtemp(join(tmpdir(), "meteroite-sync-"));
  roots.push(root);
  const fs = {
    writeFile: vi.fn(async (path: string, content: string | Uint8Array) =>
      writeFile(join(root, path), content),
    ),
    mkdir: vi.fn(
      async (path: string) =>
        (await mkdir(join(root, path), { recursive: true })) ?? path,
    ),
    rm: vi.fn(
      async (
        path: string,
        options?: { recursive?: boolean; force?: boolean },
      ) => rm(join(root, path), options),
    ),
  };
  await createFileSync(fs, [])(initial);
  fs.writeFile.mockClear();
  return {
    fs,
    sync: createFileSync(fs, initial),
    read: (path: string) => readFile(join(root, path), "utf8"),
  };
}

test("deletes files, including when the next snapshot is empty", async () => {
  const { sync, read } = await setup([file("a", "a.txt")]);
  await sync([]);
  await expect(read("a.txt")).rejects.toMatchObject({ code: "ENOENT" });
});
test("renames files and writes empty contents without rewriting unchanged files", async () => {
  const { fs, sync, read } = await setup([
    file("a", "a.txt"),
    file("b", "b.txt"),
    file("c", "c.txt"),
  ]);
  await sync([
    file("a", "renamed.txt"),
    file("b", "b.txt", ""),
    file("c", "c.txt"),
  ]);
  await expect(read("a.txt")).rejects.toMatchObject({ code: "ENOENT" });
  expect(await read("renamed.txt")).toBe("source");
  expect(await read("b.txt")).toBe("");
  expect(fs.writeFile.mock.calls.map(([path]) => path).sort()).toEqual([
    "b.txt",
    "renamed.txt",
  ]);
  fs.writeFile.mockClear();
  await sync([
    file("a", "renamed.txt"),
    file("b", "b.txt", ""),
    file("c", "c.txt"),
  ]);
  expect(fs.writeFile).not.toHaveBeenCalled();
});
test("moves files into new nested folders and handles folder renames and deletion", async () => {
  const { sync, read } = await setup([
    folder("src", "src"),
    file("a", "a.txt", "source", "src"),
  ]);
  await sync([
    folder("dest", "dest"),
    folder("nested", "nested", "dest"),
    file("a", "a.txt", "source", "nested"),
  ]);
  await expect(read("src/a.txt")).rejects.toMatchObject({ code: "ENOENT" });
  expect(await read("dest/nested/a.txt")).toBe("source");
  await sync([
    folder("dest", "renamed"),
    folder("nested", "nested", "dest"),
    file("a", "a.txt", "source", "nested"),
  ]);
  await expect(read("dest/nested/a.txt")).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(await read("renamed/nested/a.txt")).toBe("source");
  await sync([]);
  await expect(read("renamed/nested/a.txt")).rejects.toMatchObject({
    code: "ENOENT",
  });
});
test("removes old paths before writing swapped paths", async () => {
  const { sync, read } = await setup([
    file("a", "a.txt", "A"),
    file("b", "b.txt", "B"),
  ]);
  await sync([file("a", "b.txt", "A"), file("b", "a.txt", "B")]);
  expect(await read("a.txt")).toBe("B");
  expect(await read("b.txt")).toBe("A");
});
test("serializes overlapping updates", async () => {
  const { fs, sync, read } = await setup([file("a", "a.txt")]);
  const write = fs.writeFile.getMockImplementation()!;
  fs.writeFile.mockImplementationOnce(async (...args) => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    await write(...args);
  });
  await Promise.all([
    sync([file("a", "a.txt", "older")]),
    sync([file("a", "a.txt", "newer")]),
  ]);
  expect(await read("a.txt")).toBe("newer");
});

test("recreates unchanged contents when a removed folder path is reused", async () => {
  const { sync, read } = await setup([
    folder("src", "src"),
    file("a", "a.txt", "source", "src"),
  ]);
  await sync([
    folder("new-src", "src"),
    file("a", "a.txt", "source", "new-src"),
  ]);
  expect(await read("src/a.txt")).toBe("source");
});
test("reports a write failure and allows a subsequent update to retry", async () => {
  const { fs, sync, read } = await setup([file("a", "a.txt")]);
  fs.writeFile.mockRejectedValueOnce(new Error("write failed"));
  await expect(sync([file("a", "a.txt", "changed")])).rejects.toThrow(
    "write failed",
  );
  await sync([file("a", "a.txt", "changed")]);
  expect(await read("a.txt")).toBe("changed");
});
