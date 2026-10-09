import {
  createNetwork,
  createState,
  NetworkRun,
  type Agent,
  type StateData,
  type Tool,
} from "@inngest/agent-kit";
import { z } from "zod";
import type { Response } from "openai/resources/responses/responses";
import { runToolLoop } from "@/features/chatgpt/lib/tool-loop";
import type { ChatGPTSelection } from "@/features/chatgpt/lib/types";
import type { AgentResultLike, HistoryTurn } from "./conversation-history";

export type Step = NonNullable<Tool.Options<StateData>["step"]>;

/** Model rounds per turn; the last round is forced to answer without tools. */
const MAX_ITERATIONS = 7;

/** Reuses the coding agent's project tools, progress reporting, and durable steps. */
export async function runChatGPTAgent({
  selection,
  agent,
  instructions,
  history,
  message,
  step,
}: {
  selection: ChatGPTSelection;
  agent: Agent<StateData>;
  instructions: string;
  history: HistoryTurn[];
  message: string;
  step: Step;
}): Promise<{ text: string; results: AgentResultLike[] }> {
  const network = new NetworkRun(
    createNetwork({ name: "chatgpt-coding", agents: [agent] }),
    createState(),
  );
  const { text, turns } = await runToolLoop({
    selection,
    instructions,
    input: [...history, { role: "user", content: message }],
    toolset: "Read and edit the user's project files.",
    tools: [...agent.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters ?? z.object({}),
      execute: async (params) => tool.handler(params, { agent, network, step }),
    })),
    maxTurns: MAX_ITERATIONS,
    finish: { kind: "text" },
    runStep: (name, run) => step.run(name, run) as Promise<Response>,
  });
  return {
    text: text!,
    results: turns.map((calls) => ({
      toolCalls: calls.map((call) => ({
        tool: { name: call.name, input: call.input },
        content: call.output,
      })),
    })),
  };
}
