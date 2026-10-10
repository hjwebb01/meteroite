// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateText, Output } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { NextRequest } from "next/server";
import { z } from "zod";

vi.mock("@/lib/convex-client", () => ({ getConvexAdminClient: () => ({}) }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("dependency migration integration", () => {
  it("keeps structured code suggestions and token usage working through OpenRouter", async () => {
    const openRouter = createOpenRouter({
      apiKey: "test-key",
      fetch: async () =>
        Response.json({
          id: "test-completion",
          created: 1,
          model: "test-model",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: '{"suggestion":"console.log(value);"}',
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 20,
            completion_tokens: 10,
            total_tokens: 30,
            prompt_tokens_details: { cached_tokens: 4 },
            completion_tokens_details: { reasoning_tokens: 2 },
          },
        }),
    });
    const result = await generateText({
      model: openRouter.chat("test-model"),
      output: Output.object({ schema: z.object({ suggestion: z.string() }) }),
      prompt: "Complete this line",
    });
    expect(result.output.suggestion).toBe("console.log(value);");
    expect(result.usage.inputTokenDetails.cacheReadTokens).toBe(4);
    expect(result.usage.outputTokenDetails.reasoningTokens).toBe(2);
  });

  it("registers the review jobs, cancellation filters, and failure handlers with Inngest 4", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    let registration:
      | {
          functions: Array<{
            id: string;
            triggers: unknown[];
            cancel?: unknown[];
          }>;
        }
      | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, options?: RequestInit) => {
        if (options?.method === "POST") {
          registration = JSON.parse(String(options.body));
        }
        return Response.json({ status: 200, modified: true });
      }),
    );
    const { PUT } = await import("@/app/api/inngest/route");
    const response = await PUT(
      new NextRequest("http://localhost:3000/api/inngest", {
        method: "PUT",
      }),
      undefined,
    );
    expect(response.status).toBe(200);
    expect(registration).toBeDefined();
    const functions = registration!.functions;
    expect(functions.filter((fn) => fn.id.endsWith("-failure"))).toHaveLength(
      3,
    );
    expect(
      functions.find((fn) => fn.id === "meteroite-review-pull-request")
        ?.triggers,
    ).toEqual([{ event: "review/requested" }]);
    expect(
      functions.find((fn) => fn.id === "meteroite-review-pull-request")?.cancel,
    ).toEqual([
      expect.objectContaining({
        event: "review/cancel",
        if: "event.data.reviewId == async.data.reviewId",
      }),
    ]);
  });
});
