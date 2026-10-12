import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Response } from "openai/resources/responses/responses";
import { runToolLoop, ToolInputError, type LoopTool } from "./tool-loop";

const selection = { userId: "user", connectionId: "c", model: "m" };
const text = (value: string) =>
  ({
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: value }],
      },
    ],
  }) as unknown as Response;
const calls = (...items: [string, string][]) =>
  ({
    output: items.map(([name, args], index) => ({
      type: "function_call",
      namespace: "meteroite",
      name,
      call_id: `${name}-${index}`,
      arguments: args,
    })),
  }) as unknown as Response;

function fakeClient(...responses: Response[]) {
  const requests: Record<string, unknown>[] = [];
  const complete = vi.fn(async (_selection, parameters) => {
    requests.push(JSON.parse(JSON.stringify(parameters)));
    const next = responses.shift();
    if (!next) throw new Error("No scripted response");
    return next;
  });
  return { complete, requests };
}

function echoTool(execute = vi.fn(async (args: unknown) => args)): LoopTool {
  return {
    name: "echo",
    description: "Echo",
    parameters: z.object({ value: z.string() }),
    execute,
  };
}

const outputsOf = (request: Record<string, unknown>) =>
  (request.input as { type?: string; output?: string }[]).filter(
    (item) => item.type === "function_call_output",
  );

describe("runToolLoop", () => {
  it("executes tools, replays their output, and finishes with text", async () => {
    const { complete, requests } = fakeClient(
      calls(["echo", '{"value":"a"}']),
      text("Done."),
    );
    const steps: string[] = [];
    const result = await runToolLoop({
      selection,
      instructions: "Help",
      input: [{ role: "user", content: "Go" }],
      toolset: "Tools",
      tools: [echoTool()],
      finish: { kind: "text" },
      complete,
      runStep: (name, run) => {
        steps.push(name);
        return run();
      },
    });
    expect(result.text).toBe("Done.");
    expect(result.turns).toEqual([
      [{ name: "echo", input: { value: "a" }, output: '{"value":"a"}' }],
    ]);
    expect(steps).toEqual(["chatgpt-inference-0", "chatgpt-inference-1"]);
    expect(outputsOf(requests[1])).toEqual([
      expect.objectContaining({ call_id: "echo-0", output: '{"value":"a"}' }),
    ]);
  });

  it("reports bad JSON, unknown tools, foreign namespaces and input errors to the model", async () => {
    const execute = vi.fn(async () => {
      throw new ToolInputError("value is required");
    });
    const foreign = calls(["echo", "{}"]);
    (foreign.output[0] as { namespace: string }).namespace = "other";
    const { complete, requests } = fakeClient(
      calls(["echo", "{"], ["shell", "{}"], ["echo", "{}"]),
      foreign,
      text("ok"),
    );
    await runToolLoop({
      selection,
      instructions: "",
      input: [],
      toolset: "Tools",
      tools: [echoTool(execute)],
      finish: { kind: "text" },
      complete,
    });
    const errors = outputsOf(requests[2]).map(
      (item) => JSON.parse(item.output!).error,
    );
    expect(errors).toEqual([
      "Arguments must be a JSON object.",
      "Unknown tool shell.",
      "value is required",
      "Unknown tool echo.",
    ]);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("propagates tool failures that are not input errors", async () => {
    const { complete } = fakeClient(calls(["echo", "{}"]));
    await expect(
      runToolLoop({
        selection,
        instructions: "",
        input: [],
        toolset: "Tools",
        tools: [echoTool(vi.fn().mockRejectedValue(new Error("down")))],
        finish: { kind: "text" },
        complete,
      }),
    ).rejects.toThrow("down");
  });

  it("stops repeated tool requests and oversized turns", async () => {
    const repeat = calls(["echo", '{"value":"a"}']);
    const repeating = fakeClient(repeat, repeat, repeat);
    await expect(
      runToolLoop({
        selection,
        instructions: "",
        input: [],
        toolset: "Tools",
        tools: [echoTool()],
        finish: { kind: "text" },
        complete: repeating.complete,
      }),
    ).rejects.toThrow("repeated");
    const many = Array.from(
      { length: 17 },
      (_, i) => ["echo", `{"value":"${i}"}`] as [string, string],
    );
    await expect(
      runToolLoop({
        selection,
        instructions: "",
        input: [],
        toolset: "Tools",
        tools: [echoTool()],
        finish: { kind: "text" },
        complete: fakeClient(calls(...many)).complete,
      }),
    ).rejects.toThrow("too many tool calls");
  });

  it("forces a text answer on the last turn", async () => {
    const { complete, requests } = fakeClient(
      calls(["echo", '{"value":"a"}']),
      text("Final."),
    );
    await runToolLoop({
      selection,
      instructions: "",
      input: [],
      toolset: "Tools",
      tools: [echoTool()],
      maxTurns: 2,
      finish: { kind: "text" },
      complete,
    });
    expect(requests.map((r) => r.tool_choice)).toEqual(["auto", "none"]);
  });

  it("finishes with a parsed structured value, or undefined when malformed", async () => {
    const schema = z.object({ summary: z.string() });
    const answer = (args: string) =>
      ({
        output: [
          {
            type: "function_call",
            name: "answer",
            call_id: "f",
            arguments: args,
          },
        ],
      }) as unknown as Response;
    for (const [args, expected] of [
      ['{"summary":"ok"}', { summary: "ok" }],
      ["{", undefined],
      ["{}", undefined],
    ] as const) {
      const before = vi.fn();
      const { complete, requests } = fakeClient(text(""), answer(args));
      const result = await runToolLoop({
        selection,
        instructions: "",
        input: [],
        toolset: "Tools",
        tools: [],
        finish: {
          kind: "structured",
          name: "answer",
          description: "Answer",
          schema,
          instruction: "Answer now.",
          before,
        },
        complete,
      });
      expect(result.value).toEqual(expected);
      expect(before).toHaveBeenCalledOnce();
      expect(requests[1]).toMatchObject({ tool_choice: "required" });
      const finalTools = requests[1].tools as Record<string, unknown>[];
      expect(finalTools).toHaveLength(1);
      expect(finalTools[0]).toMatchObject({ type: "function", name: "answer" });
      expect(finalTools[0]).not.toHaveProperty("tools");
      if (expected) expect(result.value).toEqual(expected);
      expect(requests[1].input).toContainEqual({
        role: "user",
        content: "Answer now.",
      });
    }
  });

  it("retries one invalid structured finish and reports each rejected call", async () => {
    const schema = z.object({ summary: z.string() });
    const reasoning = {
      type: "reasoning",
      id: "final-reasoning",
      encrypted_content: "opaque",
      summary: [],
    };
    const invalid = {
      output: [
        reasoning,
        {
          type: "function_call",
          name: "answer",
          namespace: "meteroite",
          call_id: "bad-answer",
          arguments: "{",
        },
        {
          type: "function_call",
          name: "echo",
          namespace: "meteroite",
          call_id: "unaccepted-tool",
          arguments: "{}",
        },
      ],
    } as unknown as Response;
    const valid = {
      output: [
        {
          type: "function_call",
          name: "answer",
          namespace: "meteroite",
          call_id: "good-answer",
          arguments: '{"summary":"ok"}',
        },
      ],
    } as unknown as Response;
    const { complete, requests } = fakeClient(text(""), invalid, valid);
    const execute = vi.fn();
    const result = await runToolLoop({
      selection,
      instructions: "Review",
      input: [],
      toolset: "Tools",
      tools: [echoTool(execute)],
      finish: {
        kind: "structured",
        name: "answer",
        description: "Answer",
        schema,
        instruction: "Return answer.",
        maxAttempts: 2,
      },
      complete,
    });

    expect(result.value).toEqual({ summary: "ok" });
    expect(complete).toHaveBeenCalledTimes(3);
    expect(execute).not.toHaveBeenCalled();
    const correctionInput = requests[2].input as Record<string, unknown>[];
    expect(correctionInput).toContainEqual(reasoning);
    expect(correctionInput).toContainEqual(
      expect.objectContaining({
        type: "function_call_output",
        call_id: "bad-answer",
      }),
    );
    expect(correctionInput).toContainEqual(
      expect.objectContaining({
        type: "function_call_output",
        call_id: "unaccepted-tool",
      }),
    );
    expect(correctionInput.at(-1)).toMatchObject({
      role: "user",
      content: expect.stringContaining("valid JSON"),
    });
    expect(requests[2].tool_choice).toBe("required");
  });

  it.each([
    [
      "malformed JSON",
      [
        {
          type: "function_call",
          name: "answer",
          call_id: "bad-json",
          arguments: "{",
        },
      ],
    ],
    [
      "schema mismatch",
      [
        {
          type: "function_call",
          name: "answer",
          call_id: "bad-schema",
          arguments: '{"summary":1}',
        },
      ],
    ],
    [
      "wrong tool",
      [
        {
          type: "function_call",
          name: "other",
          call_id: "wrong-tool",
          arguments: "{}",
        },
      ],
    ],
    ["missing tool", []],
  ])("corrects a %s final response", async (_label, output) => {
    const valid = {
      output: [
        {
          type: "function_call",
          name: "answer",
          namespace: "meteroite",
          call_id: "good-answer",
          arguments: '{"summary":"ok"}',
        },
      ],
    } as unknown as Response;
    const bad = { output } as unknown as Response;
    const { complete } = fakeClient(text(""), bad, valid);
    const result = await runToolLoop({
      selection,
      instructions: "Review",
      input: [],
      toolset: "Tools",
      tools: [],
      finish: {
        kind: "structured",
        name: "answer",
        description: "Answer",
        schema: z.object({ summary: z.string() }),
        instruction: "Return answer.",
        maxAttempts: 2,
      },
      complete,
    });
    expect(result.value).toEqual({ summary: "ok" });
    expect(complete).toHaveBeenCalledTimes(3);
  });

  it("bounds structured correction to two invalid final attempts", async () => {
    const bad = {
      output: [
        {
          type: "function_call",
          name: "wrong",
          namespace: "meteroite",
          call_id: "bad",
          arguments: "{}",
        },
      ],
    } as unknown as Response;
    const { complete } = fakeClient(text(""), bad, bad);
    const result = await runToolLoop({
      selection,
      instructions: "",
      input: [],
      toolset: "Tools",
      tools: [],
      finish: {
        kind: "structured",
        name: "answer",
        description: "Answer",
        schema: z.object({}),
        instruction: "Answer.",
        maxAttempts: 2,
      },
      complete,
    });
    expect(result.value).toBeUndefined();
    expect(complete).toHaveBeenCalledTimes(3);
  });

  it("does not use investigation allowance to suppress a final correction", async () => {
    const bad = {
      output: [
        {
          type: "function_call",
          name: "answer",
          call_id: "bad",
          arguments: "{",
        },
      ],
    } as unknown as Response;
    const valid = {
      output: [
        {
          type: "function_call",
          name: "answer",
          call_id: "good",
          arguments: "{}",
        },
      ],
    } as unknown as Response;
    const { complete } = fakeClient(text(""), bad, valid);
    const allowances = [1, 0];
    const record = vi.fn();
    const result = await runToolLoop({
      selection,
      instructions: "",
      input: [],
      toolset: "Tools",
      tools: [],
      finish: {
        kind: "structured",
        name: "answer",
        description: "Answer",
        schema: z.object({}),
        instruction: "Answer.",
        maxAttempts: 2,
      },
      budget: { allowance: () => allowances.shift()!, record },
      complete,
    });
    expect(result.value).toEqual({});
    expect(result.budgetStopped).toBe(false);
    expect(complete).toHaveBeenCalledTimes(3);
    expect(record).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenLastCalledWith(bad, []);
  });

  it("allows final correction after investigation has no turn allowance", async () => {
    const bad = {
      output: [
        {
          type: "function_call",
          name: "answer",
          call_id: "bad",
          arguments: "{",
        },
      ],
    } as unknown as Response;
    const valid = {
      output: [
        {
          type: "function_call",
          name: "answer",
          call_id: "good",
          arguments: "{}",
        },
      ],
    } as unknown as Response;
    const { complete } = fakeClient(bad, valid);
    const result = await runToolLoop({
      selection,
      instructions: "",
      input: [],
      toolset: "Tools",
      tools: [],
      finish: {
        kind: "structured",
        name: "answer",
        description: "Answer",
        schema: z.object({}),
        instruction: "Answer.",
        maxAttempts: 2,
      },
      budget: { allowance: () => 0, record: vi.fn() },
      complete,
    });
    expect(result.value).toEqual({});
    expect(result.budgetStopped).toBe(true);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("checks cancellation before each structured correction inference", async () => {
    const bad = {
      output: [
        {
          type: "function_call",
          name: "answer",
          call_id: "bad",
          arguments: "{",
        },
      ],
    } as unknown as Response;
    const { complete } = fakeClient(text(""), bad);
    const beforeCall = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce()
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error("cancelled"));
    await expect(
      runToolLoop({
        selection,
        instructions: "",
        input: [],
        toolset: "Tools",
        tools: [],
        finish: {
          kind: "structured",
          name: "answer",
          description: "Answer",
          schema: z.object({}),
          instruction: "Answer.",
          maxAttempts: 2,
        },
        beforeCall,
        complete,
      }),
    ).rejects.toThrow("cancelled");
    expect(complete).toHaveBeenCalledTimes(2);
    expect(beforeCall).toHaveBeenCalledTimes(3);
  });

  it("checks cancellation before inference and stops investigating when the budget runs out", async () => {
    const { complete } = fakeClient();
    await expect(
      runToolLoop({
        selection,
        instructions: "",
        input: [],
        toolset: "Tools",
        tools: [],
        finish: { kind: "text" },
        complete,
        beforeCall: () => Promise.reject(new Error("cancelled")),
      }),
    ).rejects.toThrow("cancelled");
    expect(complete).not.toHaveBeenCalled();

    const final = fakeClient(calls(["echo", '{"value":"a"}']), {
      output: [
        {
          type: "function_call",
          name: "answer",
          call_id: "f",
          arguments: "{}",
        },
      ],
    } as unknown as Response);
    const allowances = [1, 0];
    const record = vi.fn();
    const result = await runToolLoop({
      selection,
      instructions: "",
      input: [],
      toolset: "Tools",
      tools: [echoTool()],
      finish: {
        kind: "structured",
        name: "answer",
        description: "Answer",
        schema: z.object({}),
        instruction: "Answer.",
      },
      budget: { allowance: () => allowances.shift()!, record },
      complete: final.complete,
    });
    expect(result.budgetStopped).toBe(true);
    expect(final.complete).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenCalledOnce();
  });
});
