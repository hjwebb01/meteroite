// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import {
  currentFindingPrice,
  maximumCallCost,
  quoteFindingModel,
} from "./finding-budget";
afterEach(() => vi.unstubAllGlobals());
test("model price is verified and conservatively reserves bounded input/output cost", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () =>
      Response.json({
        data: [
          {
            id: "known-model",
            pricing: { prompt: "0.000001", completion: "0.000004" },
          },
        ],
      }),
    ),
  );
  const quote = await quoteFindingModel("known-model");
  expect(quote.inputMicrosPerToken).toBe(2);
  expect(quote.outputMicrosPerToken).toBe(8);
  expect(maximumCallCost(quote, "system", [], 100)).toBe(16816);
  await expect(quoteFindingModel("unknown-model")).rejects.toThrow(
    "no verified price",
  );
  expect(() =>
    maximumCallCost(
      { ...quote, quotedAt: Date.now() - 1_000_000 },
      "",
      [],
      100,
    ),
  ).toThrow("expired");
});
test("queued or retried work re-quotes an expired saved price", async () => {
  const fetch = vi.fn().mockImplementation(async () =>
    Response.json({
      data: [
        {
          id: "known-model",
          pricing: { prompt: "0.000001", completion: "0.000004" },
        },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const saved = {
    inputMicrosPerToken: 1,
    outputMicrosPerToken: 1,
    quotedAt: Date.now(),
  };
  expect(await currentFindingPrice("known-model", saved)).toBe(saved);
  expect(fetch).not.toHaveBeenCalled();
  const requoted = await currentFindingPrice("known-model", {
    ...saved,
    quotedAt: Date.now() - 60 * 60_000,
  });
  expect(requoted.inputMicrosPerToken).toBe(2);
  expect(() => maximumCallCost(requoted, "", [], 100)).not.toThrow();
});
