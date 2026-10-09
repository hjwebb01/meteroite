// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import {
  assertReviewContext,
  createReviewBudget,
  estimateTokens,
  nextRequestTokens,
  turnAllowance,
} from "./context-budget";

afterEach(() => vi.unstubAllGlobals());

test("smaller model windows reduce source budgets while large models have a cost ceiling", () => {
  const small = createReviewBudget(32_000);
  const large = createReviewBudget(1_050_000);
  expect(small.diffTokens).toBeLessThan(large.diffTokens);
  expect(small.repositoryTokens).toBeLessThan(large.repositoryTokens);
  expect(small.inputTokens + small.outputTokens + 4_000).toBeLessThan(32_000);
  expect(large.inputTokens).toBe(256_000);
  expect(estimateTokens("é")).toBe(2);
  expect(() => assertReviewContext(small, small.inputTokens + 1)).toThrow(
    "model input budget",
  );
});

test("the next request uses reported usage and falls back to estimates", () => {
  const output = [{ type: "text", text: "abcd" }];
  const results = [{ lines: "1: x" }];
  const appended = estimateTokens(JSON.stringify(results));
  expect(
    nextRequestTokens(
      90_000,
      { inputTokens: 1_000, outputTokens: 200 },
      output,
      results,
    ),
  ).toBe(1_200 + appended);
  expect(nextRequestTokens(500, undefined, output, results)).toBe(
    500 + estimateTokens(JSON.stringify(output)) + appended,
  );
});

test("a turn is allowed only while it leaves room for its output and the final call", () => {
  const large = createReviewBudget(1_050_000);
  expect(turnAllowance(large, 100_000)).toBe(256_000 - 100_000 - 16_000);
  expect(turnAllowance(large, 240_000)).toBeLessThanOrEqual(0);
  const small = createReviewBudget(32_000);
  // Small windows scale the reserve down so they can still investigate.
  expect(turnAllowance(small, 5_000)).toBeGreaterThan(0);
});

test("loads the selected model's live context window and caches the catalog", async () => {
  vi.resetModules();
  const fetch = vi.fn().mockResolvedValue(
    Response.json({
      data: [
        { id: "small", context_length: 32_000 },
        { id: "large", context_length: 1_050_000 },
        { id: "openai/gpt-6.1-sol", context_length: 1_050_000 },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const { loadReviewBudget } = await import("./context-budget");
  expect(await loadReviewBudget("small")).toEqual(createReviewBudget(32_000));
  expect(await loadReviewBudget("large")).toEqual(
    createReviewBudget(1_050_000),
  );
  expect(await loadReviewBudget("chatgpt:gpt-6.1-sol")).toEqual(
    createReviewBudget(1_050_000),
  );
  expect(fetch).toHaveBeenCalledTimes(1);
  expect((await loadReviewBudget("unknown")).warning).toContain("conservative");
});

test("a catalog outage falls back without blocking reviews or caching the outage", async () => {
  vi.resetModules();
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(
      Response.json({ data: [{ id: "large", context_length: 1_050_000 }] }),
    );
  vi.stubGlobal("fetch", fetch);
  const { loadReviewBudget } = await import("./context-budget");
  expect((await loadReviewBudget("large")).warning).toContain("64,000");
  expect((await loadReviewBudget("large")).contextTokens).toBe(1_050_000);
});
