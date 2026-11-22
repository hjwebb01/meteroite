import { expect, test } from "vitest";
import { createRepositoryTools } from "./review-tools";

const reader = {
  readFile: async () => ({}),
  searchText: async () => ({}),
} as never;
const snapshot = { files: [], paths: [] } as never;

function describeOf(name: string, args: unknown) {
  const tool = createRepositoryTools(snapshot, reader, async () => {}).find(
    (candidate) => candidate.name === name,
  );
  return tool!.describe(args);
}

test("keeps repository text to one short line", () => {
  const action = describeOf("readFile", {
    path: `src/evil\nName\t${"x".repeat(300)}`,
    startLine: 1,
    endLine: 2,
  });
  expect(action.text).not.toMatch(/\p{Cc}/u);
  expect(action.text.length).toBeLessThanOrEqual(120);
  expect(action.text.endsWith("…")).toBe(true);
});

test("reports each call after validation, before the read runs", async () => {
  const calls: unknown[] = [];
  const readFile = async () => {
    calls.push("read");
    return {};
  };
  const tools = createRepositoryTools(
    snapshot,
    { readFile } as never,
    async () => {},
    (tool, description) => {
      calls.push([tool, description]);
    },
  );
  const read = tools.find((candidate) => candidate.name === "readFile")!;
  await expect(
    read.execute(
      { path: "a" },
      { callId: "1", signal: new AbortController().signal },
    ),
  ).rejects.toThrow();
  expect(calls).toEqual([]);
  await read.execute(
    { path: "src/a.ts", startLine: 1, endLine: 3 },
    { callId: "2", signal: new AbortController().signal },
  );
  expect(calls).toEqual([
    [
      "readFile",
      { text: "Reading src/a.ts", path: "src/a.ts", start: 1, end: 3 },
    ],
    "read",
  ]);
});
