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
vi.mock("ai", () => ({
  generateText: mocks.generateText,
  Output: {
    object: ({ schema }: { schema: unknown }) => ({ schema }),
  },
}));

import { POST } from "./route";

const requestBody = {
  fileName: "page.tsx",
  code: "const renamed = 1;",
  currentLine: "const renamed = 1;",
  previousLines: "",
  textBeforeCursor: "const renamed = 1;",
  textAfterCursor: "",
  nextLines: "",
  lineNumber: 1,
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

  it("accepts legacy requests without related files or recent edits", async () => {
    const response = await post(requestBody);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      edits: [{ anchor: "", replacement: " next" }],
    });
    const prompt = mocks.generateText.mock.calls[0][0].prompt as string;
    expect(prompt).not.toContain("<related_files>");
    expect(prompt).not.toContain("<recent_edits>");
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
    expect(prompt).toContain('<edit lines="1-1">');
    expect(prompt).toContain("<before>const value = 1;</before>");
    expect(prompt).toContain("<after>const renamed = 1;</after>");
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
