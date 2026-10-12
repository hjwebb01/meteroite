// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), credentials: vi.fn() }));
vi.mock("./local-account", () => ({
  getChatGPTCredentials: mocks.credentials,
}));
vi.mock("openai", async (original) => {
  const actual = await original<typeof import("openai")>();
  return {
    default: class {
      static APIError = actual.default.APIError;
      responses = { create: mocks.create };
    },
  };
});
import { completeChatGPTResponse } from "./responses";

const selection = {
  userId: "user",
  connectionId: "connection",
  model: "account-model",
};
function events(...values: unknown[]) {
  return (async function* () {
    for (const value of values) yield value;
  })();
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.credentials.mockResolvedValue("local-token");
});

describe("ChatGPT Responses execution", () => {
  it("streams without storing and waits for completed inference", async () => {
    const response = { id: "response", output: [] };
    mocks.create.mockResolvedValue(
      events(
        { type: "response.output_text.delta", delta: "Hello" },
        { type: "response.completed", response },
      ),
    );
    await expect(
      completeChatGPTResponse(selection, {
        instructions: "Help",
        input: [{ role: "user", content: "Hello" }],
      }),
    ).resolves.toBe(response);
    expect(mocks.credentials).toHaveBeenCalledWith(selection);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "account-model",
        store: false,
        stream: true,
        instructions: "Help",
      }),
      undefined,
    );
    const parameters = mocks.create.mock.calls[0][0];
    expect(parameters).not.toHaveProperty("temperature");
    expect(parameters).not.toHaveProperty("max_output_tokens");
    expect(parameters).not.toHaveProperty("previous_response_id");
  });

  it("keeps completed output items when the completed response omits them", async () => {
    const functionCall = {
      type: "function_call",
      id: "call-1",
      call_id: "call-1",
      name: "return_review",
      arguments: '{"findings":[]}',
      status: "completed",
    };
    const reasoning = {
      type: "reasoning",
      id: "reasoning-1",
      summary: [],
      encrypted_content: "opaque-encrypted-value",
    };
    const message = {
      type: "message",
      id: "message-1",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "Review complete." }],
    };
    const response = {
      id: "response",
      output: [],
      status: "completed",
      usage: { input_tokens: 12, output_tokens: 7, total_tokens: 19 },
    };
    mocks.create.mockResolvedValue(
      events(
        { type: "response.output_item.done", output_index: 2, item: message },
        {
          type: "response.output_item.done",
          output_index: 0,
          item: functionCall,
        },
        { type: "response.output_item.done", output_index: 1, item: reasoning },
        { type: "response.completed", response },
      ),
    );

    const completed = await completeChatGPTResponse(selection, { input: [] });

    expect(completed.output).toEqual([functionCall, reasoning, message]);
    expect(completed).toMatchObject({
      status: "completed",
      usage: response.usage,
    });
  });

  it("does not duplicate completed items already present in the response", async () => {
    const functionCall = {
      type: "function_call",
      id: "call-1",
      call_id: "call-1",
      name: "return_review",
      arguments: '{"findings":[]}',
      status: "completed",
    };
    const response = {
      id: "response",
      output: [functionCall],
      status: "completed",
    };
    mocks.create.mockResolvedValue(
      events(
        {
          type: "response.output_item.done",
          output_index: 0,
          item: functionCall,
        },
        { type: "response.completed", response },
      ),
    );

    const completed = await completeChatGPTResponse(selection, { input: [] });

    expect(completed.output).toEqual([functionCall]);
  });

  it("does not treat partial text or a truncated stream as success", async () => {
    mocks.create.mockResolvedValue(
      events({ type: "response.output_text.delta", delta: "Partial" }),
    );
    await expect(
      completeChatGPTResponse(selection, { input: [] }),
    ).rejects.toThrow("interrupted");
  });

  it("does not treat completed items from an interrupted stream as success", async () => {
    mocks.create.mockResolvedValue(
      events({
        type: "response.output_item.done",
        output_index: 0,
        item: { type: "function_call", name: "return_review" },
      }),
    );
    await expect(
      completeChatGPTResponse(selection, { input: [] }),
    ).rejects.toThrow("interrupted");
  });

  it("reports a plan limit received after streaming begins", async () => {
    mocks.create.mockResolvedValue(
      events(
        { type: "response.output_text.delta", delta: "Partial" },
        {
          type: "response.failed",
          response: {
            error: { code: "subscription_sharing_usage_limit_exceeded" },
          },
        },
      ),
    );
    await expect(
      completeChatGPTResponse(selection, { input: [] }),
    ).rejects.toThrow("limit has been reached");
  });

  it("rejects incomplete responses", async () => {
    mocks.create.mockResolvedValue(
      events({ type: "response.incomplete", response: { output: [] } }),
    );
    await expect(
      completeChatGPTResponse(selection, { input: [] }),
    ).rejects.toThrow("could not complete");
  });
});
