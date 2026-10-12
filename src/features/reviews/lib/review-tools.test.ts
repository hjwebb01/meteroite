import { expect, test, vi } from "vitest";
import { z } from "zod";
import { createRepositoryTools, defineReviewTool } from "./review-tools";

const call = { callId: "call-1", signal: new AbortController().signal };

test("validates arguments before running a review tool", async () => {
  const run = vi.fn().mockResolvedValue({ ok: true });
  const tool = defineReviewTool({
    name: "readFile",
    description: "Read lines",
    parameters: z.object({ path: z.string(), startLine: z.number().int() }),
    run,
  });

  await expect(
    tool.execute({ path: "src/auth.ts", startLine: 1.5 }, call),
  ).rejects.toThrow();
  expect(run).not.toHaveBeenCalled();

  expect(
    await tool.execute({ path: "src/auth.ts", startLine: 1 }, call),
  ).toEqual({ ok: true });
  expect(run).toHaveBeenCalledWith({ path: "src/auth.ts", startLine: 1 }, call);
});

test("repository tools pass explicit search cursors and paginate file listings", async () => {
  const paths = Array.from({ length: 61 }, (_, index) => ({
    path: `src/file-${String(index).padStart(2, "0")}.ts`,
  }));
  const searchText = vi.fn().mockResolvedValue({
    matches: [],
    partial: true,
    scannedFiles: 25,
    scannedLines: 0,
    nextCursor: { fileOffset: 25, lineOffset: 0 },
  });
  const reader = {
    readFile: vi.fn(),
    searchText,
  } as never;
  const tools = createRepositoryTools(
    { files: [], paths } as never,
    reader,
    async () => {},
  );
  const search = tools.find((tool) => tool.name === "searchText")!;
  const list = tools.find((tool) => tool.name === "listFiles")!;

  await search.execute(
    {
      query: "target",
      pathPrefix: "src/",
      cursor: { fileOffset: 25, lineOffset: 0 },
    },
    call,
  );
  expect(searchText).toHaveBeenCalledWith("target", "src/", {
    fileOffset: 25,
    lineOffset: 0,
  });
  const firstPage = (await list.execute({ prefix: "src/" }, call)) as {
    paths: string[];
  };
  expect(firstPage.paths).toHaveLength(50);
  expect(await list.execute({ prefix: "src/", cursor: 50 }, call)).toEqual({
    paths: [
      "src/file-50.ts",
      "src/file-51.ts",
      "src/file-52.ts",
      "src/file-53.ts",
      "src/file-54.ts",
      "src/file-55.ts",
      "src/file-56.ts",
      "src/file-57.ts",
      "src/file-58.ts",
      "src/file-59.ts",
      "src/file-60.ts",
    ],
    total: 61,
    partial: false,
    nextCursor: null,
  });
});
