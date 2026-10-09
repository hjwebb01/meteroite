import { expect, test, vi } from "vitest";
import { z } from "zod";
import { defineReviewTool } from "./review-tools";

const call = { callId: "call-1", signal: new AbortController().signal };

test("validates arguments before running a review tool", async () => {
  const run = vi.fn().mockResolvedValue({ ok: true });
  const tool = defineReviewTool({
    name: "readFile",
    description: "Read lines",
    parameters: z.object({ path: z.string(), startLine: z.number().int() }),
    run,
  });

  await expect(
    tool.execute({ path: "src/auth.ts", startLine: 1.5 }, call),
  ).rejects.toThrow();
  expect(run).not.toHaveBeenCalled();

  expect(
    await tool.execute({ path: "src/auth.ts", startLine: 1 }, call),
  ).toEqual({ ok: true });
  expect(run).toHaveBeenCalledWith({ path: "src/auth.ts", startLine: 1 }, call);
});
