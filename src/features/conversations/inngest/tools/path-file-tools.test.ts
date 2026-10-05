// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { internal } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { MessageProgressReporter } from "../message-progress";
import { createUpdateFileTool } from "./update-file";
import { createRenameFileTool } from "./rename-file";
import { createDeleteFilesTool } from "./delete-files";
import { createEditFileTool } from "./edit-file";
import { createReadFilesTool } from "./read-files";

const { mutation, query } = vi.hoisted(() => ({
  mutation: vi.fn(),
  query: vi.fn(),
}));
vi.mock("@/lib/convex-client", () => ({
  getConvexAdminClient: () => ({ mutation, query }),
}));

function setup() {
  mutation.mockReset();
  query.mockReset();
  const options = {
    projectId: "project" as Id<"projects">,
    reporter: {
      toolStart: vi.fn(async () => "step"),
      toolEnd: vi.fn(async () => {}),
    } as unknown as MessageProgressReporter,
  };
  const context = {
    step: {
      run: async (_name: string, callback: () => Promise<string>) => callback(),
    },
  } as unknown as Parameters<
    ReturnType<typeof createEditFileTool>["handler"]
  >[1];
  return { options, context };
}

describe("agent file tool path interface", () => {
  it("updates, renames, and deletes without queries or listing IDs", async () => {
    const { options, context } = setup();
    const path = "src/app.ts";
    await createUpdateFileTool(options).handler(
      { path, content: "updated" },
      context,
    );
    expect(mutation).toHaveBeenLastCalledWith(
      internal.agentFiles.agentUpdateFileByPath,
      { projectId: options.projectId, path, content: "updated" },
    );
    await createRenameFileTool(options).handler(
      { path, newName: "main.ts" },
      context,
    );
    expect(mutation).toHaveBeenLastCalledWith(
      internal.agentFiles.agentRenameFileByPath,
      { projectId: options.projectId, path, newName: "main.ts" },
    );
    mutation.mockResolvedValueOnce([{ path, alreadyMissing: false }]);
    expect(
      await createDeleteFilesTool(options).handler({ paths: [path] }, context),
    ).toContain(`Deleted "${path}"`);
    expect(mutation).toHaveBeenLastCalledWith(
      internal.agentFiles.agentDeleteFilesByPaths,
      { projectId: options.projectId, paths: [path] },
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("sends only literal edits and reports clear mutation failures", async () => {
    const { options, context } = setup();
    const tool = createEditFileTool(options);
    const edits = [{ search: "old\r\ntext", replace: "new\\n$&" }];
    mutation.mockResolvedValueOnce({ editsApplied: 1 });
    expect(await tool.handler({ path: "large.ts", edits }, context)).toContain(
      "1 edit(s)",
    );
    expect(mutation).toHaveBeenCalledWith(internal.agentFiles.agentEditFile, {
      projectId: options.projectId,
      path: "large.ts",
      edits,
    });
    expect(query).not.toHaveBeenCalled();
    mutation.mockRejectedValueOnce(
      new Error("Edit 1: search string is ambiguous"),
    );
    expect(await tool.handler({ path: "large.ts", edits }, context)).toBe(
      "Error editing file: Edit 1: search string is ambiguous",
    );
    expect(options.reporter.toolEnd).toHaveBeenLastCalledWith(
      "step",
      false,
      "Edit 1: search string is ambiguous",
    );
  });

  it("rejects empty edit requests before writing", async () => {
    const { options, context } = setup();
    const tool = createEditFileTool(options);
    for (const edits of [[], [{ search: "", replace: "x" }]]) {
      expect(await tool.handler({ path: "app.ts", edits }, context)).toMatch(
        /^Error:/,
      );
    }
    expect(mutation).not.toHaveBeenCalled();
  });

  it("reads by path without requiring fileIds", async () => {
    const { options, context } = setup();
    query.mockResolvedValueOnce([]);
    await createReadFilesTool(options).handler(
      {
        paths: ["app.ts"],
        format: "compact",
        maxChars: 80000,
        lineStart: 1,
        lineEnd: 1,
      },
      context,
    );
    expect(query).toHaveBeenCalledWith(internal.agentFiles.agentReadFiles, {
      projectId: options.projectId,
      paths: ["app.ts"],
      fileIds: [],
      maxChars: 80000,
      lineStart: 1,
      lineEnd: 1,
    });
  });
});
