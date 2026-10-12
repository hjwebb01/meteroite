import { beforeEach, expect, test, vi } from "vitest";
import { z } from "zod";
const mocks = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("@/features/chatgpt/lib/responses", async (original) => ({
  ...(await original<typeof import("@/features/chatgpt/lib/responses")>()),
  completeChatGPTResponse: mocks.complete,
}));
import { malformedReview, runChatGPTReview } from "./chatgpt-review";
import { createReviewBudget } from "./context-budget";
import { defineReviewTool, type ReviewToolCall } from "./review-tools";

function readFileTool(
  run: (input: { path: string }, call: ReviewToolCall) => Promise<unknown>,
) {
  return defineReviewTool({
    name: "readFile",
    description: "Read source lines",
    parameters: z.object({ path: z.string() }),
    run,
  });
}

const review = {
  assessment: null,
  hotspots: [],
  changeGroups: [],
  summary: "No confirmed defects",
  findings: [],
  limitations: ["Tests were not run"],
};
const finalResponse = {
  output: [
    {
      type: "function_call",
      name: "return_review",
      call_id: "final",
      arguments: JSON.stringify(review),
    },
  ],
};
const selection = {
  userId: "alice",
  connectionId: "connection",
  model: "account-model",
};
function options() {
  return {
    selection,
    system: "Inspect the repository",
    context: "PR context",
    tools: [],
    budget: createReviewBudget(),
    signal: new AbortController().signal,
    checkActive: vi.fn().mockResolvedValue(undefined),
    prepareFindings: vi.fn().mockResolvedValue(undefined),
  };
}
beforeEach(() => vi.clearAllMocks());

test("executes validated repository tools and replays reasoning and evidence into the final review", async () => {
  const reasoning = {
    type: "reasoning",
    id: "reason",
    encrypted_content: "encrypted",
    summary: [],
  };
  mocks.complete
    .mockResolvedValueOnce({
      output: [
        reasoning,
        {
          type: "function_call",
          name: "readFile",
          call_id: "read-1",
          arguments: JSON.stringify({ path: "src/auth.ts" }),
        },
      ],
    })
    .mockResolvedValueOnce({ output: [] })
    .mockResolvedValueOnce(finalResponse);
  const run = vi.fn().mockResolvedValue({ lines: ["1: authorize(user)"] });
  const config = {
    ...options(),
    tools: [readFileTool(run)],
  };
  expect(await runChatGPTReview(config)).toEqual({
    output: review,
    budgetStopped: false,
  });
  expect(run).toHaveBeenCalledWith(
    { path: "src/auth.ts" },
    { callId: "read-1", signal: config.signal },
  );
  const final = mocks.complete.mock.calls[2];
  expect(final[0]).toEqual(selection);
  expect(final[1].input).toEqual(
    expect.arrayContaining([
      reasoning,
      expect.objectContaining({
        type: "function_call_output",
        call_id: "read-1",
        output: JSON.stringify({ lines: ["1: authorize(user)"] }),
      }),
    ]),
  );
  expect(final[1].tool_choice).toBe("required");
  expect(final[1].tools).toHaveLength(1);
  expect(final[1].tools[0]).toMatchObject({
    type: "function",
    name: "return_review",
  });
  expect(final[1].tools[0]).not.toHaveProperty("tools");
  const finalInstruction = final[1].input.at(-1);
  expect(finalInstruction).toMatchObject({
    content: expect.stringContaining(
      "assessment, hotspots, changeGroups, summary, findings, and limitations",
    ),
  });
  expect(finalInstruction).toMatchObject({
    content: expect.stringContaining("Assessment alone is invalid"),
  });
  expect(final[2].signal).toBe(config.signal);
  expect(config.prepareFindings).toHaveBeenCalledOnce();
});

test("degrades a missing or malformed final review to an incomplete one", async () => {
  const bad = (args: string) => ({
    output: [
      {
        type: "function_call",
        name: "return_review",
        call_id: "final",
        arguments: args,
      },
    ],
  });
  for (const final of [{ output: [] }, bad("{"), bad("{}")]) {
    mocks.complete
      .mockResolvedValueOnce({ output: [] })
      .mockResolvedValueOnce(final)
      .mockResolvedValueOnce(final);
    expect(await runChatGPTReview(options())).toEqual({
      output: malformedReview(),
      budgetStopped: false,
    });
  }
  expect(malformedReview().assessment?.state).toBe("incomplete");
});

test("corrects one malformed final review and preserves the rejected call transcript", async () => {
  mocks.complete
    .mockResolvedValueOnce({ output: [] })
    .mockResolvedValueOnce({
      output: [
        {
          type: "function_call",
          name: "return_review",
          namespace: "meteroite",
          call_id: "bad-final",
          arguments: "{",
        },
      ],
    })
    .mockResolvedValueOnce(finalResponse);
  const config = options();

  expect(await runChatGPTReview(config)).toEqual({
    output: review,
    budgetStopped: false,
  });
  expect(mocks.complete).toHaveBeenCalledTimes(3);
  expect(config.prepareFindings).toHaveBeenCalledTimes(2);
  const correction = mocks.complete.mock.calls[2][1];
  expect(correction.tool_choice).toBe("required");
  expect(correction.input).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "function_call",
        call_id: "bad-final",
      }),
      expect.objectContaining({
        type: "function_call_output",
        call_id: "bad-final",
      }),
    ]),
  );
  expect(correction.input.at(-1)).toMatchObject({
    role: "user",
    content: expect.stringContaining("schema-valid"),
  });
});

test("keeps fallback without marking investigation stopped when correction exceeds context", async () => {
  const budget = createReviewBudget(32_000);
  mocks.complete.mockResolvedValueOnce({ output: [] }).mockResolvedValueOnce({
    output: [
      {
        type: "function_call",
        name: "return_review",
        namespace: "meteroite",
        call_id: "bad-final",
        arguments: "{",
      },
    ],
    usage: { input_tokens: budget.inputTokens, output_tokens: 0 },
  });

  expect(await runChatGPTReview({ ...options(), budget })).toEqual({
    output: malformedReview(),
    budgetStopped: false,
  });
  expect(mocks.complete).toHaveBeenCalledTimes(2);
});

test("checks cancellation before a final correction and propagates inference failures", async () => {
  mocks.complete.mockResolvedValueOnce({ output: [] }).mockResolvedValueOnce({
    output: [
      {
        type: "function_call",
        name: "return_review",
        call_id: "bad-final",
        arguments: "{",
      },
    ],
  });
  const config = options();
  config.checkActive
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("Review cancelled"));
  await expect(runChatGPTReview(config)).rejects.toThrow("cancelled");
  expect(mocks.complete).toHaveBeenCalledTimes(2);

  mocks.complete.mockReset();
  mocks.complete
    .mockResolvedValueOnce({ output: [] })
    .mockRejectedValueOnce(new Error("network unavailable"));
  await expect(runChatGPTReview(options())).rejects.toThrow(
    "network unavailable",
  );
  expect(mocks.complete).toHaveBeenCalledTimes(2);
});

test("enforces context limits and cancellation before inference", async () => {
  await expect(
    runChatGPTReview({
      ...options(),
      context: "const user = await loadUser(id);\n".repeat(10_000),
    }),
  ).rejects.toThrow("input budget");
  const config = options();
  config.checkActive.mockRejectedValue(new Error("Review cancelled"));
  await expect(runChatGPTReview(config)).rejects.toThrow("cancelled");
  expect(mocks.complete).not.toHaveBeenCalled();
});

test("stops investigating before tool results crowd out the final review", async () => {
  const budget = createReviewBudget(1_050_000);
  const readCall = (id: string) => ({
    output: [
      {
        type: "function_call",
        name: "readFile",
        call_id: id,
        arguments: JSON.stringify({ path: "src/auth.ts" }),
      },
    ],
    usage: { input_tokens: 240_000, output_tokens: 1_000 },
  });
  mocks.complete
    .mockResolvedValueOnce(readCall("read-1"))
    .mockResolvedValueOnce(finalResponse);
  const limitTurn = vi.fn();
  const run = vi.fn().mockResolvedValue({ content: "1: authorize(user)" });
  const result = await runChatGPTReview({
    ...options(),
    budget,
    limitTurn,
    tools: [readFileTool(run)],
  });
  expect(result).toEqual({ output: review, budgetStopped: true });
  // One investigation turn, then the final call instead of a second turn.
  expect(mocks.complete).toHaveBeenCalledTimes(2);
  expect(mocks.complete.mock.calls[1][1].tool_choice).toBe("required");
  expect(limitTurn).toHaveBeenCalledOnce();
  expect(limitTurn.mock.calls[0][0]).toBeGreaterThan(0);
});
