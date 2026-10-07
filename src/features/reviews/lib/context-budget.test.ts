// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import {
  assertReviewContext,
  createReviewBudget,
  estimateTokens,
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
  expect(() =>
    assertReviewContext(small, "System", [
      { role: "user", content: "x".repeat(32_000) },
    ]),
  ).toThrow("model input budget");
});

test("loads the selected model's live context window and caches the catalog", async () => {
  vi.resetModules();
  const fetch = vi.fn().mockResolvedValue(
    Response.json({
      data: [
        { id: "small", context_length: 32_000 },
        { id: "large", context_length: 1_050_000 },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const { loadReviewBudget } = await import("./context-budget");
  expect(await loadReviewBudget("small")).toEqual(createReviewBudget(32_000));
  expect(await loadReviewBudget("large")).toEqual(
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
