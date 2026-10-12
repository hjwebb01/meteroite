// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import {
  ContextBudgetError,
  createReviewBudget,
  createReviewContextBudget,
  estimateTokens,
} from "./context-budget";

afterEach(() => vi.unstubAllGlobals());

test("counts code and Unicode tokens with headroom rather than charging every byte", () => {
  expect(estimateTokens("Hello, world!")).toBe(5);
  expect(estimateTokens("你好，世界🌍")).toBe(6);
  const code = "const user = await loadUser(id);\n".repeat(100);
  expect(estimateTokens(code)).toBeLessThan(Buffer.byteLength(code) / 2);
  expect(estimateTokens("")).toBe(0);
});

test("token-like strings in repository content are counted as literal text", () => {
  expect(estimateTokens("<|endoftext|>")).toBe(9);
});

test("bounds counting work on long repetitive source without losing compression", () => {
  const source = "a".repeat(400_000);
  const started = performance.now();
  expect(estimateTokens(source)).toBe(57_500);
  expect(performance.now() - started).toBeLessThan(2_000);
  // A chunk boundary must not split a Unicode surrogate pair.
  expect(
    estimateTokens("a".repeat(4_095) + "🌍" + "a".repeat(4_095)),
  ).toBeGreaterThan(0);
});

test("smaller model windows reduce source budgets while large models have a cost ceiling", () => {
  const small = createReviewBudget(32_000);
  const large = createReviewBudget(1_050_000);
  expect(small.diffTokens).toBeLessThan(large.diffTokens);
  expect(small.repositoryTokens).toBeLessThan(large.repositoryTokens);
  expect(small.inputTokens + small.outputTokens + 4_000).toBeLessThan(32_000);
  expect(large.inputTokens).toBe(256_000);
  expect(estimateTokens("é")).toBe(2);
});

function contextBudget(
  budget = createReviewBudget(1_050_000),
  limitTurn?: (tokens: number) => void,
) {
  return createReviewContextBudget({
    budget,
    system: "Inspect source",
    context: "Pull request",
    finalInstruction: "Return the final review",
    limitTurn,
  });
}

test("reported usage replaces the estimate and tool results reduce source allowance", () => {
  const state = contextBudget();
  const output = [{ type: "text", text: "abcd" }];
  const results = [{ lines: "1: x" }];
  state.record({ inputTokens: 1_000, outputTokens: 200 }, output, results);
  expect(state.allowance()).toBe(
    256_000 - 16_000 - 1_200 - estimateTokens(JSON.stringify(results)),
  );
  expect(state.prepareFinal()).toBe(true);
});

test("missing usage accumulates output and tool results across turns", () => {
  const state = contextBudget();
  const initial = state.allowance();
  const output = [{ type: "text", text: "Inspected the caller" }];
  const results = [{ lines: "1: authorize(user)" }];
  const added =
    estimateTokens(JSON.stringify(output)) +
    estimateTokens(JSON.stringify(results));
  state.record(undefined, output, results);
  state.record(undefined, output, results);
  expect(state.allowance()).toBe(initial - 2 * added);
  expect(state.prepareFinal()).toBe(true);
});

test("investigation exhaustion stops source delivery but leaves room for the final review", () => {
  const limitTurn = vi.fn();
  const state = contextBudget(undefined, limitTurn);
  expect(state.allowance()).toBeGreaterThan(0);
  state.record({ inputTokens: 240_000, outputTokens: 1_000 }, [], []);
  expect(state.allowance()).toBeLessThanOrEqual(0);
  expect(limitTurn).toHaveBeenCalledOnce();
  expect(state.prepareFinal()).toBe(true);
  expect(contextBudget(createReviewBudget(32_000)).allowance()).toBeGreaterThan(
    0,
  );
});

test("the final instruction must fit even when no investigation ran", () => {
  const state = createReviewContextBudget({
    budget: createReviewBudget(32_000),
    system: "Inspect source",
    context: "const user = await loadUser(id);\n".repeat(10_000),
    finalInstruction: "Return the final review",
  });
  expect(state.allowance()).toBeLessThanOrEqual(0);
  expect(() => state.prepareFinal()).toThrow(ContextBudgetError);
});

test("correction overhead is charged after a rejected final call and skipped when it cannot fit", () => {
  const budget = createReviewBudget(32_000);
  const state = contextBudget(budget);
  const correction = [{ role: "user", content: "Correct the rejected output" }];
  expect(state.prepareFinal()).toBe(true);
  state.record({ inputTokens: 1_000, outputTokens: 200 }, [], []);
  expect(state.prepareFinal(correction)).toBe(true);
  state.record({ inputTokens: budget.inputTokens, outputTokens: 0 }, [], []);
  expect(state.prepareFinal(correction)).toBe(false);
  expect(() => state.prepareFinal()).toThrow(ContextBudgetError);
});

test("final calls accept an exact fit and account for correction-only overflow", () => {
  const budget = createReviewBudget(32_000);
  const state = contextBudget(budget);
  state.record(
    {
      inputTokens:
        budget.inputTokens -
        estimateTokens("Return the final review") -
        estimateTokens(JSON.stringify([])),
      outputTokens: 0,
    },
    [],
    [],
  );
  expect(state.prepareFinal()).toBe(true);
  expect(state.prepareFinal([{ role: "user", content: "Try again" }])).toBe(
    false,
  );
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
