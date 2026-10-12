// @vitest-environment node
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { NonRetriableError } from "inngest";
import { expect, test, vi } from "vitest";
import { z } from "zod";
import { createReviewBudget } from "../lib/context-budget";
import { defineReviewTool } from "../lib/review-tools";
import { runReviewAgent } from "./review-agent";

const output = {
  assessment: null,
  hotspots: [],
  changeGroups: [],
  summary: "No confirmed defects",
  findings: [],
  limitations: ["Tests were not run"],
};

test.each([true, false])(
  "OpenRouter retains inspected evidence when reported usage exhausts context: %s",
  async (exhausted) => {
    const requests: Array<{
      messages: Array<{ role: string; content: unknown }>;
      tools?: unknown[];
    }> = [];
    const provider = createOpenRouter({
      apiKey: "test-key",
      fetch: async (_url, options) => {
        const body = JSON.parse(String(options?.body));
        requests.push(body);
        const first = requests.length === 1;
        const final = !body.tools;
        return Response.json({
          id: `completion-${requests.length}`,
          created: 1,
          model: "test-model",
          choices: [
            {
              index: 0,
              message: first
                ? {
                    role: "assistant",
                    content: null,
                    tool_calls: [
                      {
                        id: "read-1",
                        type: "function",
                        function: {
                          name: "readFile",
                          arguments: JSON.stringify({ path: "src/auth.ts" }),
                        },
                      },
                    ],
                  }
                : {
                    role: "assistant",
                    content: final
                      ? JSON.stringify(output)
                      : "Investigation finished",
                  },
              finish_reason: first ? "tool_calls" : "stop",
            },
          ],
          ...(exhausted
            ? {
                usage: {
                  prompt_tokens: 240_000,
                  completion_tokens: 1_000,
                  total_tokens: 241_000,
                },
              }
            : {}),
        });
      },
    });
    const limitTurn = vi.fn();
    const read = vi.fn().mockResolvedValue({ content: "1: authorize(user)" });
    const result = await runReviewAgent({
      provider: { model: provider.chat("test-model") },
      system: "Inspect the repository",
      context: "Pull request context",
      budget: createReviewBudget(1_050_000),
      tools: [
        defineReviewTool({
          name: "readFile",
          description: "Read source lines",
          parameters: z.object({ path: z.string() }),
          run: read,
        }),
      ],
      limitTurn,
      maxTurns: 8,
      signal: new AbortController().signal,
      checkActive: async () => {},
      prepareFindings: async () => {},
    });

    expect(result).toEqual({ output, budgetStopped: exhausted });
    expect(read).toHaveBeenCalledOnce();
    expect(requests).toHaveLength(exhausted ? 2 : 3);
    expect(requests.at(-1)?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          content: expect.stringContaining("authorize(user)"),
        }),
      ]),
    );
    if (exhausted) expect(limitTurn).toHaveBeenCalledOnce();
  },
);

test("an oversized tool-free OpenRouter review fails before sending a request", async () => {
  const fetch = vi.fn();
  const provider = createOpenRouter({ apiKey: "test-key", fetch });
  await expect(
    runReviewAgent({
      provider: { model: provider.chat("test-model") },
      system: "Inspect source",
      context: "const user = await loadUser(id);\n".repeat(10_000),
      budget: createReviewBudget(32_000),
      tools: [],
      maxTurns: 0,
      signal: new AbortController().signal,
      checkActive: async () => {},
      prepareFindings: async () => {},
    }),
  ).rejects.toThrow(NonRetriableError);
  expect(fetch).not.toHaveBeenCalled();
});
