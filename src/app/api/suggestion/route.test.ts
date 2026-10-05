// @vitest-environment edge-runtime
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  chat: vi.fn(),
  generateText: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/openrouter", () => ({
  openRouter: { chat: mocks.chat },
}));
vi.mock("ai", async (importActual) => ({
  ...(await importActual<typeof import("ai")>()),
  generateText: mocks.generateText,
  Output: {
    object: ({ schema }: { schema: unknown }) => ({ schema }),
  },
}));

import { POST } from "./route";

const requestBody = {
  fileName: "page.tsx",
  code: "const renamed = 1;<|cursor|>",
};

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/suggestion", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

describe("POST /api/suggestion optional context", () => {
  beforeEach(() => {
    mocks.auth.mockResolvedValue({ userId: "user_123" });
    mocks.chat.mockReturnValue({ modelId: "mock-model" });
    mocks.generateText.mockResolvedValue({
      output: { edits: [{ anchor: "", replacement: " next" }] },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("accepts requests without related files or recent edits", async () => {
    const response = await post(requestBody);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      edits: [{ anchor: "", replacement: " next" }],
    });
    const prompt = mocks.generateText.mock.calls[0][0].prompt as string;
    expect(prompt).not.toContain("<related_files>");
    expect(prompt).not.toContain("<recent_edits>");
  });

  it("uses the default model unless a supported one is selected", async () => {
    await post(requestBody);
    await post({ ...requestBody, model: "z-ai/glm-5.3-flash" });
    const rejected = await post({ ...requestBody, model: "unknown/model" });

    expect(mocks.chat.mock.calls).toEqual([
      ["qwen/qwen3-coder-next"],
      ["z-ai/glm-5.3-flash"],
    ]);
    expect(rejected.status).toBe(400);
  });

  it("adds provided related signatures and recent edits to the model prompt", async () => {
    const response = await post({
      ...requestBody,
      relatedFiles: [
        {
          path: "src/lib/math.ts",
          signatures: "export function add(a: number, b: number): number;",
        },
      ],
      recentEdits: [
        {
          startLine: 1,
          endLine: 1,
          before: "const value = 1;",
          after: "const renamed = 1;",
        },
      ],
    });

    expect(response.status).toBe(200);
    const prompt = mocks.generateText.mock.calls[0][0].prompt as string;
    expect(prompt).toContain('<file path="src/lib/math.ts">');
    expect(prompt).toContain(
      "export function add(a: number, b: number): number;",
    );
    expect(prompt.indexOf("<related_files>")).toBeLessThan(
      prompt.indexOf("<file_excerpt"),
    );
    expect(prompt.indexOf("<file_excerpt")).toBeLessThan(
      prompt.indexOf("<recent_edits>"),
    );
    expect(prompt).toContain("-const value = 1;");
    expect(prompt).toContain("+const renamed = 1;");
  });
});

it("returns anchored replacements and drops no-op edits", async () => {
  mocks.auth.mockResolvedValue({ userId: "user_123" });
  mocks.generateText.mockResolvedValue({
    output: {
      edits: [
        { anchor: "renamed", replacement: "updated" },
        { anchor: "same", replacement: "same" },
      ],
    },
  });
  expect(await (await post(requestBody)).json()).toEqual({
    edits: [{ anchor: "renamed", replacement: "updated" }],
  });
});

it("sets generation limits and forwards the request abort signal", async () => {
  const request = new Request("http://localhost/api/suggestion", {
    method: "POST",
    body: JSON.stringify(requestBody),
  });
  mocks.auth.mockResolvedValue({ userId: "user_123" });
  mocks.generateText.mockResolvedValue({ output: { edits: [] } });
  await POST(request);
  const options = mocks.generateText.mock.calls.at(-1)![0];
  expect(options.abortSignal).toBe(request.signal);
  expect(options.temperature).toBe(0);
  expect(options.maxOutputTokens).toBe(384);
  expect(options.prompt).toContain("<|cursor|>");
  expect(options.system).toContain("exact, unique");
  expect(mocks.chat).toHaveBeenLastCalledWith("qwen/qwen3-coder-next");
});

it("returns useful validation errors before generating", async () => {
  mocks.auth.mockResolvedValue({ userId: "user_123" });
  const response = await post({ ...requestBody, code: "missing marker" });
  expect(response.status).toBe(400);
  expect((await response.json()).error).toContain(
    "code: Code must contain the cursor marker",
  );
});

it("escapes paths in prompt attributes and preserves literal dollar sequences", async () => {
  mocks.auth.mockResolvedValue({ userId: "user_123" });
  mocks.generateText.mockResolvedValue({ output: { edits: [] } });
  await post({
    ...requestBody,
    fileName: 'a"><evil>',
    code: "$&<|cursor|>",
    relatedFiles: [{ path: 'b"&', signatures: "export const x: string;" }],
  });
  const prompt = mocks.generateText.mock.calls.at(-1)![0].prompt;
  expect(prompt).toContain('path="a&quot;&gt;&lt;evil&gt;"');
  expect(prompt).toContain('path="b&quot;&amp;"');
  expect(prompt).toContain("$&<|cursor|>");
});

it("strips echoed cursor markers from returned edits", async () => {
  mocks.auth.mockResolvedValue({ userId: "user_123" });
  mocks.generateText.mockResolvedValue({
    output: {
      edits: [{ anchor: "rena<|cursor|>med", replacement: "<|cursor|>next" }],
    },
  });
  const response = await post(requestBody);
  expect(await response.json()).toEqual({
    edits: [{ anchor: "renamed", replacement: "next" }],
  });
});

it("returns no edits when the model output is truncated or unparseable", async () => {
  const { NoOutputGeneratedError } = await import("ai");
  mocks.auth.mockResolvedValue({ userId: "user_123" });
  mocks.generateText.mockRejectedValue(new NoOutputGeneratedError());
  const response = await post(requestBody);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ edits: [] });
});
