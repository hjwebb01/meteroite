// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  selection: vi.fn(),
  mutation: vi.fn(),
  send: vi.fn(),
}));
vi.mock("@/lib/convex-auth", () => ({ getConvexAuth: mocks.auth }));
vi.mock("@/features/chatgpt/lib/local-account", () => ({
  getChatGPTSelection: mocks.selection,
}));
vi.mock("convex/nextjs", () => ({ fetchMutation: mocks.mutation }));
vi.mock("@/inngest/client", () => ({ inngest: { send: mocks.send } }));
import { POST } from "./route";

const post = (extra = {}) =>
  POST(
    new Request("http://localhost:3000/api/messages", {
      method: "POST",
      headers: {
        Origin: "http://localhost:3000",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId: "conversation",
        message: "Edit the page",
        ...extra,
      }),
    }),
  );

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ userId: "owner", token: "convex-token" });
  mocks.selection.mockResolvedValue(undefined);
  mocks.mutation.mockResolvedValue({
    projectId: "project",
    userMessageId: "user-message",
    assistantMessageId: "assistant",
    cancelledMessageIds: [],
    model: "openrouter-model",
  });
  mocks.send.mockResolvedValue({ ids: ["event"] });
});

describe("message provider routing", () => {
  it("snapshots the authenticated user's local connection without accepting caller-supplied credentials", async () => {
    const selection = {
      userId: "owner",
      connectionId: "connection",
      model: "account-model",
    };
    mocks.selection.mockResolvedValue(selection);
    expect(
      (
        await post({
          chatGPT: { userId: "another-user", accessToken: "forged-token" },
        })
      ).status,
    ).toBe(200);
    expect(mocks.selection).toHaveBeenCalledWith("owner", expect.any(Request));
    expect(mocks.mutation.mock.calls[0][2]).toEqual({ token: "convex-token" });
    expect(mocks.send.mock.calls[0][0].data.provider).toEqual({
      kind: "chatgpt",
      selection,
    });
    expect(JSON.stringify(mocks.send.mock.calls)).not.toContain("token");
  });

  it("rejects unavailable subscription access before creating a processing message", async () => {
    mocks.selection.mockRejectedValue(new Error("Reconnect ChatGPT."));
    const response = await post();
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Reconnect ChatGPT." });
    expect(mocks.mutation).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("continues using OpenRouter when no subscription is selected", async () => {
    expect((await post()).status).toBe(200);
    expect(mocks.send.mock.calls[0][0].data.provider).toEqual({
      kind: "openrouter",
    });
  });

  it("requires authentication before accessing local accounts", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await post()).status).toBe(401);
    expect(mocks.selection).not.toHaveBeenCalled();
  });
});
