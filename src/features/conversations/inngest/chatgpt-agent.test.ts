// @vitest-environment node
import { createAgent, type StateData, type Tool } from "@inngest/agent-kit";
import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("@/features/chatgpt/lib/responses", async (original) => ({
  ...(await original<typeof import("@/features/chatgpt/lib/responses")>()),
  completeChatGPTResponse: mocks.complete,
}));
import { runChatGPTAgent } from "./chatgpt-agent";
import { defineProjectTool } from "./tools/define-project-tool";

const selection = {
  userId: "user",
  connectionId: "local-connection",
  model: "account-model",
};
const final = {
  output: [
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Updated the file." }],
    },
  ],
};
const call = {
  output: [
    {
      type: "function_call",
      namespace: "meteroite",
      name: "editFile",
      call_id: "call-1",
      arguments: '{"content":"changed"}',
    },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
});

describe("ChatGPT coding turns", () => {
  it("reuses durable project tools, replays outputs and history, and preserves turn summaries", async () => {
    const reporter = {
      toolStart: vi.fn().mockResolvedValue("tool-progress"),
      toolEnd: vi.fn(),
    };
    const edit = vi
      .fn()
      .mockResolvedValue('{"path":"src/app.ts","action":"updated"}');
    const tool = defineProjectTool({
      name: "editFile",
      description: "Edit a file",
      parameters: z.object({ content: z.string() }),
      reporter,
      label: () => "src/app.ts",
      run: edit,
    });
    const agent = createAgent({
      name: "coding",
      system: "Help",
      tools: [tool],
    });
    const steps: string[] = [];
    const step = {
      run: async (name: string, execute: () => unknown) => {
        steps.push(name);
        return execute();
      },
    } as Tool.Options<StateData>["step"];
    const requests: Record<string, unknown>[] = [];
    mocks.complete.mockImplementation(async (_selection, parameters) => {
      requests.push(JSON.parse(JSON.stringify(parameters)));
      return requests.length === 1 ? call : final;
    });
    const result = await runChatGPTAgent({
      selection,
      agent,
      instructions: "Edit this project",
      history: [{ role: "assistant", content: "Earlier context" }],
      message: "Change the file",
      step: step!,
    });
    expect(edit).toHaveBeenCalledWith({ content: "changed" });
    expect(steps).toEqual([
      "chatgpt-inference-0",
      "edit-file",
      "chatgpt-inference-1",
    ]);
    expect(requests[0]).toMatchObject({
      instructions: "Edit this project",
      input: [
        { role: "assistant", content: "Earlier context" },
        { role: "user", content: "Change the file" },
      ],
      tools: [{ type: "namespace", name: "meteroite" }],
    });
    expect(requests[1].input).toContainEqual({
      type: "function_call_output",
      call_id: "call-1",
      output: '{"path":"src/app.ts","action":"updated"}',
    });
    expect(result.text).toBe("Updated the file.");
    expect(result.results[0].toolCalls[0].tool).toEqual({
      name: "editFile",
      input: { content: "changed" },
    });
    expect(reporter.toolEnd).toHaveBeenCalledWith("tool-progress", true);
  });
});
