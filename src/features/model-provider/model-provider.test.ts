// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ coding: vi.fn(), review: vi.fn() }));
vi.mock("@/features/chatgpt/lib/local-account", () => ({
  getChatGPTSelection: mocks.coding,
  getChatGPTReviewSelection: mocks.review,
}));
import { modelProviderForReview, resolveModelProvider } from "./model-provider";

const request = new Request("http://localhost:3000/api");
const selection = { userId: "alice", connectionId: "c", model: "gpt" };
beforeEach(() => vi.resetAllMocks());

describe("resolveModelProvider", () => {
  it("follows the owner's ChatGPT preference for conversation turns", async () => {
    mocks.coding.mockResolvedValue(selection);
    expect(await resolveModelProvider("alice", request)).toEqual({
      provider: { kind: "chatgpt", selection },
    });
    mocks.coding.mockResolvedValue(undefined);
    expect(await resolveModelProvider("alice", request)).toEqual({
      provider: { kind: "openrouter" },
    });
  });

  it("uses the Review's chosen model without consulting the coding preference", async () => {
    mocks.review.mockResolvedValue(selection);
    expect(await resolveModelProvider("alice", request, "chatgpt:gpt")).toEqual(
      { provider: { kind: "chatgpt", selection } },
    );
    expect(mocks.review).toHaveBeenCalledWith("alice", request, "gpt");
    expect(
      await resolveModelProvider("alice", request, "openai/gpt-5.3-codex"),
    ).toEqual({ provider: { kind: "openrouter" } });
    expect(mocks.coding).not.toHaveBeenCalled();
  });

  it("returns a 400 when ChatGPT cannot be used", async () => {
    mocks.coding.mockRejectedValue(new Error("Reconnect ChatGPT."));
    const result = await resolveModelProvider("alice", request);
    if (!("response" in result)) throw new Error("expected a response");
    expect(result.response.status).toBe(400);
    expect(await result.response.json()).toEqual({
      error: "Reconnect ChatGPT.",
    });
  });
});

describe("modelProviderForReview", () => {
  const chatgpt = { kind: "chatgpt", selection } as const;
  it("accepts matching providers", () => {
    expect(
      modelProviderForReview({ model: "chatgpt:gpt" }, "alice", chatgpt),
    ).toBe(chatgpt);
    expect(modelProviderForReview({ model: "openai/x" }, "alice")).toEqual({
      kind: "openrouter",
    });
  });

  it("rejects missing, foreign or mismatched ChatGPT selections", () => {
    expect(() =>
      modelProviderForReview({ model: "chatgpt:gpt" }, "alice"),
    ).toThrow("Reconnect ChatGPT");
    expect(() =>
      modelProviderForReview({ model: "chatgpt:gpt" }, "bob", chatgpt),
    ).toThrow("Reconnect ChatGPT");
    expect(() =>
      modelProviderForReview({ model: "chatgpt:other" }, "alice", chatgpt),
    ).toThrow("Reconnect ChatGPT");
    expect(() =>
      modelProviderForReview({ model: "openai/x" }, "alice", chatgpt),
    ).toThrow("does not match");
  });
});
