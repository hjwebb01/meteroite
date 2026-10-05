// @vitest-environment edge-runtime
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  chat: vi.fn(),
  streamText: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/openrouter", () => ({ openRouter: { chat: mocks.chat } }));
vi.mock("ai", () => ({ streamText: mocks.streamText }));
import { POST } from "./route";

const body = {
  path: "page.tsx",
  contextBefore: "before\n",
  region: "a<|cursor|>b\n",
  contextAfter: "after",
  recentEdits: "-old\n+new",
};
const request = (value: unknown) =>
  new Request("http://localhost/api/suggestion/next-edit", {
    method: "POST",
    body: JSON.stringify(value),
    headers: { "content-type": "application/json" },
  });

describe("next-edit POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ userId: "user_123" });
    mocks.chat.mockReturnValue("model");
    mocks.streamText.mockReturnValue({
      toTextStreamResponse: () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("<region>aXb\n"));
              controller.close();
            },
          }),
          { headers: { "content-type": "text/plain; charset=utf-8" } },
        ),
    });
  });
  it("authenticates before generation", async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    expect((await POST(request(body))).status).toBe(403);
    expect(mocks.streamText).not.toHaveBeenCalled();
  });
  it.each([
    { ...body, region: "ab" },
    { ...body, region: "<|cursor|><|cursor|>" },
    { ...body, recentEdits: [] },
    { ...body, path: "" },
    {},
  ])("rejects invalid body %j", async (value) => {
    expect((await POST(request(value))).status).toBe(400);
    expect(mocks.streamText).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON", async () => {
    expect(
      (
        await POST(
          new Request("http://localhost", { method: "POST", body: "{" }),
        )
      ).status,
    ).toBe(400);
  });
  it("streams plain text with static instructions, cancellation, and a stop sequence", async () => {
    const req = request({
      ...body,
      relatedFiles: [
        { path: "math.ts", signatures: "export const add: Function" },
      ],
    });
    const response = await POST(req);
    expect(await response.text()).toBe("<region>aXb\n");
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(mocks.chat).toHaveBeenCalledWith("qwen/qwen3-coder-next");
    const options = mocks.streamText.mock.calls[0][0];
    expect(options).toMatchObject({
      model: "model",
      abortSignal: req.signal,
      temperature: 0,
      maxOutputTokens: 261,
      stopSequences: ["</region>"],
    });
    expect(options.system).toContain("Context before and after is read-only");
    expect(options.prompt).toBe(
      [
        "<related_files>",
        '<file path="math.ts">',
        "export const add: Function",
        "</file>",
        "</related_files>",
        '<file path="page.tsx">',
        "<context_before>\nbefore\n</context_before>",
        "<editable_region>\na<|cursor|>b\n</editable_region>",
        "<context_after>\nafter</context_after>",
        "</file>",
        "<recent_edits>\n-old\n+new\n</recent_edits>",
      ].join("\n"),
    );
    expect(options.system).not.toContain(body.recentEdits);
  });
  it("sizes the output budget to the region and rejects oversized regions", async () => {
    await POST(request({ ...body, region: "x".repeat(3000) + "<|cursor|>" }));
    expect(mocks.streamText.mock.calls[0][0].maxOutputTokens).toBe(1260);
    const response = await POST(
      request({ ...body, region: "x".repeat(4000) + "<|cursor|>" }),
    );
    expect(response.status).toBe(400);
  });
  it("returns a server error when generation setup fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.streamText.mockImplementationOnce(() => {
      throw new Error("failed");
    });
    expect((await POST(request(body))).status).toBe(500);
    log.mockRestore();
  });
});
