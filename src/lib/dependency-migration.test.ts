// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateText, Output } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import ky, { HTTPError } from "ky";
import { NextRequest } from "next/server";
import { z } from "zod";
import { getHttpErrorMessage } from "./http-error";

vi.mock("@/lib/convex-client", () => ({ convex: {} }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("dependency migration integration", () => {
  it("falls back to the generic GitHub error for a non-JSON response", async () => {
    try {
      await ky.post("https://example.test/api/github/export", {
        retry: 0,
        fetch: async () => new Response("Bad gateway", { status: 502 }),
      });
      expect.unreachable("Expected an HTTP error");
    } catch (error) {
      expect(error).toBeInstanceOf(HTTPError);
      expect(getHttpErrorMessage(error as HTTPError)).toBeUndefined();
    }
  });

  it.each(["Pro plan required", "GitHub not connected"])(
    "preserves the GitHub error action for %s with Ky 2",
    async (message) => {
      try {
        await ky.post("https://example.test/api/github/import", {
          retry: 0,
          fetch: async () => Response.json({ error: message }, { status: 403 }),
        });
        expect.unreachable("Expected an HTTP error");
      } catch (error) {
        expect(error).toBeInstanceOf(HTTPError);
        expect(getHttpErrorMessage(error as HTTPError)).toBe(message);
        expect((error as HTTPError).response.bodyUsed).toBe(true);
      }
    },
  );

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

  it("registers the project jobs, cancellation filters, and failure handlers with Inngest 4", async () => {
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
    expect(
      functions.find((fn) => fn.id === "meteroite-import-github-repo")
        ?.triggers,
    ).toEqual([{ event: "github/import.repo" }]);
    expect(
      functions.find((fn) => fn.id === "meteroite-export-to-github")?.cancel,
    ).toEqual([
      expect.objectContaining({
        event: "github/export.cancel",
        if: "event.data.jobId == async.data.jobId",
      }),
    ]);
    expect(
      functions.find((fn) => fn.id === "meteroite-process-message")?.cancel,
    ).toEqual([
      expect.objectContaining({
        event: "message/cancel",
        if: "event.data.messageId == async.data.messageId",
      }),
    ]);
    expect(functions.filter((fn) => fn.id.endsWith("-failure"))).toHaveLength(
      3,
    );
  });
});
