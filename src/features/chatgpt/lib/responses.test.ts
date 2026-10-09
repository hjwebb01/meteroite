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

  it("does not treat partial text or a truncated stream as success", async () => {
    mocks.create.mockResolvedValue(
      events({ type: "response.output_text.delta", delta: "Partial" }),
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
