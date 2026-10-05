// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineProjectTool } from "./define-project-tool";

function setup() {
  const reporter = {
    toolStart: vi.fn(async () => "progress-1"),
    toolEnd: vi.fn(async () => {}),
  };
  const run = vi.fn(async ({ path }: { path: string }) => `Created ${path}`);
  const tool = defineProjectTool({
    name: "createFolder",
    description: "Create a folder",
    parameters: z.object({ path: z.string() }),
    validation: z.object({
      path: z.string().min(1, "Folder path is required"),
    }),
    reporter,
    label: ({ path }) => path,
    run,
    errorPrefix: "Error creating folder",
  });
  const stepRun = vi.fn(
    async (_name: string, callback: () => Promise<string>) => callback(),
  );
  // The helper only consumes step from Agent Kit's execution context.
  const context = { step: { run: stepRun } } as unknown as Parameters<
    typeof tool.handler
  >[1];
  return { tool, reporter, run, stepRun, context };
}

describe("defineProjectTool", () => {
  it("wraps execution in the existing step name and reports start/end in order", async () => {
    const { tool, reporter, run, stepRun, context } = setup();
    expect(await tool.handler({ path: "src" }, context)).toBe("Created src");
    expect(stepRun).toHaveBeenCalledWith("create-folder", expect.any(Function));
    expect(run).toHaveBeenCalledWith({ path: "src" });
    expect(reporter.toolStart).toHaveBeenCalledWith("createFolder", "src");
    expect(reporter.toolEnd).toHaveBeenCalledWith("progress-1", true);
    expect(reporter.toolStart.mock.invocationCallOrder[0]).toBeLessThan(
      run.mock.invocationCallOrder[0],
    );
    expect(run.mock.invocationCallOrder[0]).toBeLessThan(
      reporter.toolEnd.mock.invocationCallOrder[0],
    );
  });

  it.each([
    [new Error("Denied"), "Denied"],
    ["failure", "Unknown error"],
  ])("formats execution errors and reports failure", async (error, message) => {
    const { tool, reporter, run, context } = setup();
    run.mockRejectedValueOnce(error);
    expect(await tool.handler({ path: "src" }, context)).toBe(
      `Error creating folder: ${message}`,
    );
    expect(reporter.toolEnd).toHaveBeenCalledWith("progress-1", false, message);
  });

  it("returns validation errors before progress or execution", async () => {
    const { tool, reporter, run, context } = setup();
    expect(await tool.handler({ path: "" }, context)).toBe(
      "Error: Folder path is required",
    );
    expect(reporter.toolStart).not.toHaveBeenCalled();
    expect(reporter.toolEnd).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("preserves empty output and successful progress when step is absent", async () => {
    const { tool, reporter, run, context } = setup();
    expect(
      await tool.handler({ path: "src" }, { ...context, step: undefined }),
    ).toBe("");
    expect(run).not.toHaveBeenCalled();
    expect(reporter.toolEnd).toHaveBeenCalledWith("progress-1", true);
  });

  it("supports preflight results and contextual error formatting", async () => {
    const { reporter, context } = setup();
    const tool = defineProjectTool({
      name: "updateFile",
      description: "Update a file",
      parameters: z.object({ fileId: z.string() }),
      reporter,
      prepare: async ({ fileId }) =>
        fileId === "missing" ? "Error: Missing file" : { name: "app.ts" },
      label: ({ name }) => name,
      run: async () => {
        throw new Error("Denied");
      },
      formatError: (message, { name }) =>
        `Error: ${message} while updating file "${name}".`,
    });
    expect(await tool.handler({ fileId: "missing" }, context)).toBe(
      "Error: Missing file",
    );
    expect(reporter.toolStart).not.toHaveBeenCalled();
    expect(await tool.handler({ fileId: "valid" }, context)).toBe(
      'Error: Denied while updating file "app.ts".',
    );
    expect(reporter.toolStart).toHaveBeenCalledWith("updateFile", "app.ts");
  });
});
