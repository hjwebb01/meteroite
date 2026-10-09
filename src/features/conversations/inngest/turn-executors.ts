import {
  createAgent,
  createNetwork,
  type Agent,
  type Message,
  type NetworkRun,
  type StateData,
  type TextMessage,
} from "@inngest/agent-kit";
import { NonRetriableError } from "inngest";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  CODING_AGENT_SYSTEM_PROMPT,
  TITLE_GENERATOR_SYSTEM_PROMPT,
} from "./constants";
import { createReadFilesTool } from "./tools/read-files";
import { createListFilesTool } from "./tools/list-files";
import { createEditFileTool } from "./tools/edit-file";
import { createUpdateFileTool } from "./tools/update-file";
import { createCreateFilesTool } from "./tools/create-files";
import { createCreateFolderTool } from "./tools/create-folder";
import { createDeleteFilesTool } from "./tools/delete-files";
import { createRenameFileTool } from "./tools/rename-file";
import { createScrapeUrlsTool } from "./tools/scrape-urls";
import type { MessageProgressReporter } from "./message-progress";
import { createCodingModel, createTitleModel } from "./models";
import {
  completeChatGPTResponse,
  responseText,
} from "@/features/chatgpt/lib/responses";
import type { ChatGPTSelection } from "@/features/chatgpt/lib/types";
import { runChatGPTAgent, type Step } from "./chatgpt-agent";
import type { ModelProvider } from "@/features/model-provider/model-provider";
import type { HistoryTurn } from "./conversation-history";
import { withHistoryTurns } from "./conversation-history";
import type { TurnResult } from "./complete-turn";

/** Cap agent loop iterations to reduce token accumulation and latency. */
const CODING_AGENT_MAX_ITER = 7;
const EMPTY_OPENROUTER_RESPONSE =
  "I processed your request. Let me know if you need anything else.";

/**
 * One provider's share of a message: title generation and the coding turn.
 * Both return plain data; progress and persistence live with the caller.
 */
export interface TurnExecutor {
  /** Raw title text; the caller trims it and decides whether to save it. */
  generateTitle(message: string): Promise<string>;
  runTurn(message: string): Promise<TurnResult>;
  /**
   * Applies the provider's retry policy to an error from `generateTitle` or
   * `runTurn`. Persistence errors must not pass through it: they are retried
   * independently of the memoized inference.
   */
  failure(error: unknown, phase: "title" | "turn"): unknown;
}

interface TurnExecutorOptions {
  projectId: Id<"projects">;
  reporter: MessageProgressReporter;
  /** Prior turns, oldest → newest. */
  historyTurns: HistoryTurn[];
}

/** One executor per message, chosen by its Model provider. */
export function createTurnExecutor({
  provider,
  model,
  step,
  ...options
}: TurnExecutorOptions & {
  provider: ModelProvider;
  model?: string | null;
  step: Step;
}): TurnExecutor {
  return provider.kind === "chatgpt"
    ? createChatGPTExecutor({ ...options, selection: provider.selection, step })
    : createOpenRouterExecutor({ ...options, model });
}

const titleAgent = createAgent({
  name: "conversation-title",
  system: TITLE_GENERATOR_SYSTEM_PROMPT,
  model: createTitleModel(),
});

function createProjectTools({
  projectId,
  reporter,
}: {
  projectId: Id<"projects">;
  reporter: MessageProgressReporter;
}) {
  return [
    createListFilesTool({ projectId, reporter }),
    createReadFilesTool({ projectId, reporter }),
    createUpdateFileTool({ projectId, reporter }),
    createEditFileTool({ projectId, reporter }),
    createCreateFilesTool({ projectId, reporter }),
    createCreateFolderTool({ projectId, reporter }),
    createDeleteFilesTool({ projectId, reporter }),
    createRenameFileTool({ projectId, reporter }),
    createScrapeUrlsTool({ reporter }),
  ];
}

function textOf(message: TextMessage): string {
  return typeof message.content === "string"
    ? message.content
    : message.content.map((c) => c.text).join("");
}

function assistantText(output: Message[]): string | undefined {
  const message = output.find(
    (msg): msg is TextMessage =>
      msg.type === "text" && msg.role === "assistant",
  );
  return message && textOf(message);
}

/** The name survives Inngest's error serialization, so onFailure can tell provider errors apart. */
export const CHATGPT_PROVIDER_ERROR_NAME = "ChatGPTProviderError";

class ChatGPTProviderError extends NonRetriableError {
  constructor(message: string) {
    super(message);
    this.name = CHATGPT_PROVIDER_ERROR_NAME;
  }
}

function toProviderError(error: unknown, fallback: string) {
  return new ChatGPTProviderError(
    error instanceof Error ? error.message : fallback,
  );
}

/**
 * Stops the OpenRouter loop once the model answers in text, and after two
 * identical tool-call rounds in a row.
 */
export function createCodingRouter(agent: Agent<StateData>) {
  let lastToolCallFingerprint: string | undefined;
  let duplicateToolCallStreak = 0;
  return ({ network }: { network: NetworkRun<StateData> }) => {
    const lastResult = network.state.results.at(-1);
    const hasTextResponse = lastResult?.output.some(
      (msg) => msg.type === "text" && msg.role === "assistant",
    );
    const hasToolCall = lastResult?.output.some(
      (msg) => msg.type === "tool_call",
    );

    const toolCallMsg = lastResult?.output.find(
      (msg) => msg.type === "tool_call",
    );
    if (toolCallMsg) {
      const fp = JSON.stringify(toolCallMsg);
      if (fp === lastToolCallFingerprint) {
        duplicateToolCallStreak += 1;
      } else {
        lastToolCallFingerprint = fp;
        duplicateToolCallStreak = 0;
      }
      if (duplicateToolCallStreak >= 2) {
        return undefined;
      }
    } else {
      lastToolCallFingerprint = undefined;
      duplicateToolCallStreak = 0;
    }

    if (hasTextResponse && !hasToolCall) {
      return undefined;
    }
    return agent;
  };
}

function createOpenRouterExecutor({
  projectId,
  reporter,
  historyTurns,
  model,
}: TurnExecutorOptions & { model?: string | null }): TurnExecutor {
  // Turn objects are reused across lifecycle calls; withHistoryTurns relies on identity.
  const historyMessages: TextMessage[] = historyTurns.map((turn) => ({
    type: "text",
    role: turn.role,
    content: turn.content,
  }));
  const codingAgent = createAgent({
    name: "meteroite",
    description: "Default Meteroite coding assistant (OpenRouter)",
    system: CODING_AGENT_SYSTEM_PROMPT,
    model: createCodingModel(model),
    lifecycle: {
      onStart: ({ prompt, history }) => ({
        prompt: withHistoryTurns(prompt, historyMessages),
        history: history ?? [],
        stop: false,
      }),
    },
    tools: createProjectTools({ projectId, reporter }),
  });

  return {
    failure: (error) => error,
    // Must not run inside step.run: agent-kit uses step.ai.infer, which nests step tooling.
    async generateTitle(message) {
      const { output } = await titleAgent.run(message);
      return assistantText(output) ?? "";
    },
    async runTurn(message) {
      const network = createNetwork({
        name: "meteroite-network",
        agents: [codingAgent],
        maxIter: CODING_AGENT_MAX_ITER,
        router: createCodingRouter(codingAgent),
      });
      const run = await network.run(message);
      return {
        text:
          assistantText(run.state.results.at(-1)?.output ?? []) ??
          EMPTY_OPENROUTER_RESPONSE,
        results: run.state.results,
      };
    },
  };
}

function createChatGPTExecutor({
  selection,
  step,
  projectId,
  reporter,
  historyTurns,
}: TurnExecutorOptions & {
  selection: ChatGPTSelection;
  step: Step;
}): TurnExecutor {
  const agent = createAgent({
    name: "meteroite",
    system: CODING_AGENT_SYSTEM_PROMPT,
    tools: createProjectTools({ projectId, reporter }),
  });

  return {
    failure(error, phase) {
      return toProviderError(
        error,
        phase === "title"
          ? "ChatGPT title generation failed."
          : "ChatGPT could not complete this turn.",
      );
    },
    async generateTitle(message) {
      return step.run("chatgpt-title", async () =>
        responseText(
          await completeChatGPTResponse(selection, {
            instructions: TITLE_GENERATOR_SYSTEM_PROMPT,
            input: [{ role: "user", content: message }],
          }),
        ),
      );
    },
    async runTurn(message) {
      return runChatGPTAgent({
        selection,
        agent,
        instructions: CODING_AGENT_SYSTEM_PROMPT,
        history: historyTurns,
        message,
        step,
      });
    },
  };
}
