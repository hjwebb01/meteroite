import { z } from "zod";
import type {
  Response,
  ResponseInput,
} from "openai/resources/responses/responses";
import {
  completeChatGPTResponse,
  functionDefinition,
  functionNamespace,
  responseText,
} from "./responses";
import type { ChatGPTSelection } from "./types";

/** Arguments the model can correct; the loop reports it back instead of failing the run. */
export class ToolInputError extends Error {}

export type LoopTool = {
  name: string;
  description?: string;
  parameters: z.ZodType;
  execute: (
    args: Record<string, unknown>,
    call: { callId: string; signal?: AbortSignal },
  ) => Promise<unknown>;
};

export type ToolCallRecord = {
  name: string;
  input: Record<string, unknown>;
  output: string;
};

type Finish =
  | { kind: "text" }
  | {
      kind: "structured";
      name: string;
      description: string;
      schema: z.ZodType;
      instruction: string;
      /** Runs after investigation, before the final call. */
      before?: () => Promise<void> | void;
    };

const MAX_CALLS_PER_TURN = 16;
const NAMESPACE = "meteroite";

/**
 * Runs a ChatGPT Responses tool loop. Native output items, including encrypted
 * reasoning, are replayed across turns. Investigation ends when the model stops
 * calling tools, the budget leaves no room for another turn, or `maxTurns` is
 * reached. A text finish forces a tool-free answer on the last turn; a
 * structured finish makes one more call that must return `finish.name`, whose
 * parsed arguments are `value` (undefined when malformed).
 */
export async function runToolLoop<Value = unknown>({
  selection,
  instructions,
  input: initialInput,
  toolset,
  tools,
  maxTurns = 8,
  finish,
  signal,
  beforeCall,
  budget,
  runStep = (_name, run) => run(),
  complete = completeChatGPTResponse,
}: {
  selection: ChatGPTSelection;
  instructions: string;
  input: ResponseInput;
  /** Describes the tool namespace to the model. */
  toolset: string;
  tools: LoopTool[];
  maxTurns?: number;
  finish: Finish;
  signal?: AbortSignal;
  /** Runs before every inference and tool call; throw to stop the run. */
  beforeCall?: () => Promise<void>;
  budget?: {
    /** Tokens the coming turn may use; zero or less ends investigation. */
    allowance(): number;
    record(response: Response, results: ResponseInput): void;
  };
  /** Wraps each inference, e.g. in a durable step. */
  runStep?: (name: string, run: () => Promise<Response>) => Promise<Response>;
  complete?: typeof completeChatGPTResponse;
}): Promise<{
  text?: string;
  value?: Value;
  turns: ToolCallRecord[][];
  budgetStopped: boolean;
}> {
  const input: ResponseInput = [...initialInput];
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const namespace = functionNamespace(
    toolset,
    tools.map((tool) =>
      functionDefinition(tool.name, tool.description, tool.parameters, {
        unrepresentable: "any",
      }),
    ),
  );
  const infer = (
    name: string,
    parameters: Parameters<typeof completeChatGPTResponse>[1],
  ) =>
    // Resolve credentials inside the step, never as serialized step output.
    runStep(name, () =>
      complete(selection, { instructions, ...parameters }, { signal }),
    );
  const turns: ToolCallRecord[][] = [];
  let budgetStopped = false;
  let fingerprint = "";
  let repeated = 0;

  for (let turn = 0; turn < maxTurns; turn++) {
    await beforeCall?.();
    if (budget && budget.allowance() <= 0) {
      budgetStopped = true;
      break;
    }
    const lastTextTurn = finish.kind === "text" && turn === maxTurns - 1;
    const response = await infer(`chatgpt-inference-${turn}`, {
      input,
      tools: [namespace],
      tool_choice: lastTextTurn ? "none" : "auto",
    });
    const calls = response.output.filter(
      (item) => item.type === "function_call",
    );
    if (!calls.length) {
      budget?.record(response, []);
      if (finish.kind === "structured") {
        input.push(...(response.output as ResponseInput));
        break;
      }
      const text = responseText(response);
      if (!text.trim())
        throw new Error("ChatGPT returned no assistant response. Try again.");
      return { text, turns, budgetStopped };
    }
    if (lastTextTurn) break;
    if (calls.length > MAX_CALLS_PER_TURN)
      throw new Error("ChatGPT requested too many tool calls in one turn.");
    const nextFingerprint = JSON.stringify(
      calls.map((call) => [call.name, call.arguments]),
    );
    repeated = nextFingerprint === fingerprint ? repeated + 1 : 0;
    fingerprint = nextFingerprint;
    if (repeated >= 2)
      throw new Error(
        "ChatGPT repeated the same tool requests. Please try a more specific instruction.",
      );
    // Responses output is valid replay input, even after JSON serialization.
    input.push(...(response.output as ResponseInput));
    const results: ResponseInput = [];
    const records: ToolCallRecord[] = [];
    for (const call of calls) {
      await beforeCall?.();
      const { input: args, output } = await executeCall(call, byName, signal);
      records.push({ name: call.name, input: args, output });
      results.push({
        type: "function_call_output",
        call_id: call.call_id,
        output,
      });
    }
    input.push(...results);
    turns.push(records);
    budget?.record(response, results);
  }

  if (finish.kind === "text")
    throw new Error(
      "ChatGPT reached this turn's tool limit. Send a follow-up to continue.",
    );
  await finish.before?.();
  input.push({ role: "user", content: finish.instruction });
  const response = await infer("chatgpt-inference-final", {
    input,
    tools: [
      functionNamespace(finish.description, [
        functionDefinition(finish.name, finish.description, finish.schema),
      ]),
    ],
    tool_choice: "required",
  });
  const calls = response.output.filter((item) => item.type === "function_call");
  let value: Value | undefined;
  if (calls.length === 1 && calls[0].name === finish.name) {
    try {
      value = finish.schema.parse(JSON.parse(calls[0].arguments)) as Value;
    } catch {
      // Malformed; callers supply their own fallback.
    }
  }
  return { value, turns, budgetStopped };
}

async function executeCall(
  call: {
    name: string;
    namespace?: string;
    call_id: string;
    arguments: string;
  },
  tools: Map<string, LoopTool>,
  signal?: AbortSignal,
): Promise<{ input: Record<string, unknown>; output: string }> {
  const error = (message: string, input: Record<string, unknown> = {}) => ({
    input,
    output: JSON.stringify({ error: message }),
  });
  const tool =
    !call.namespace || call.namespace === NAMESPACE
      ? tools.get(call.name)
      : undefined;
  if (!tool) return error(`Unknown tool ${call.name}.`);
  let args: Record<string, unknown>;
  try {
    args = z.record(z.string(), z.unknown()).parse(JSON.parse(call.arguments));
  } catch {
    return error("Arguments must be a JSON object.");
  }
  try {
    const result = await tool.execute(args, { callId: call.call_id, signal });
    return {
      input: args,
      output:
        typeof result === "string" ? result : (JSON.stringify(result) ?? ""),
    };
  } catch (caught) {
    if (caught instanceof ToolInputError) return error(caught.message, args);
    throw caught;
  }
}
