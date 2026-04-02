import { inngest } from "@/inngest/client";
import { Id } from "../../../../convex/_generated/dataModel";
import { NonRetriableError } from "inngest";
import { createAgent, createNetwork, openai } from "@inngest/agent-kit";
import { convex } from "@/lib/convex-client";
import { api } from "../../../../convex/_generated/api";
import {
  CODING_AGENT_SYSTEM_PROMPT,
  OPENROUTER_GPT_5_4_MINI,
  OPENROUTER_OPENAI_BASE_URL,
  TITLE_GENERATOR_SYSTEM_PROMPT,
} from "./constants";
import { DEFAULT_CONVERSATION_TITLE } from "../../../../convex/constants";
import { createReadFilesTool } from "./tools/read-files";
import { createListFilesTool } from "./tools/list-files";
import { createUpdateFileTool } from "./tools/update-file";
import { createCreateFilesTool } from "./tools/create-files";
import { createCreateFolderTool } from "./tools/create-folder";
import { createDeleteFilesTool } from "./tools/delete-files";
import { createRenameFileTool } from "./tools/rename-file";
import { createScrapeUrlsTool } from "./tools/scrape-urls";
import { createMessageProgressReporter } from "./message-progress";

const titleModel = openai({
  model: OPENROUTER_GPT_5_4_MINI,
  baseUrl: OPENROUTER_OPENAI_BASE_URL,
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultParameters: {
    temperature: 0,
    reasoning: { effort: "low" },
    // OpenRouter extended params (not in default typings)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any,
});

const baseModel = openai({
  model: OPENROUTER_GPT_5_4_MINI,
  baseUrl: OPENROUTER_OPENAI_BASE_URL,
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultParameters: {
    temperature: 0.3,
    reasoning: { effort: "medium" },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenRouter extended params
  } as any,
});

const titleAgent = createAgent({
  name: "conversation-title",
  system: TITLE_GENERATOR_SYSTEM_PROMPT,
  model: titleModel,
});

interface MessageEvent {
  messageId: Id<"messages">;
  conversationId: Id<"conversations">;
  projectId: Id<"projects">;
  message: string;
}

export const processMessage = inngest.createFunction(
  {
    id: "process-message",
    cancelOn: [
      {
        event: "message/cancel",
        if: "event.data.messageId == async.data.messageId",
      },
    ],
    onFailure: async ({ event, step }) => {
      const { messageId } = event.data.event.data as MessageEvent;

      const internalKey = process.env.METEROITE_CONVEX_INTERNAL_KEY;
      if (internalKey) {
        await step.run("update-message-on-failure", async () => {
          await convex.mutation(api.system.updateMessageContent, {
            internalKey,
            messageId,
            content: "Failed to generate assistant message",
          });
        });
      }
    },
  },
  {
    event: "message/sent",
  },
  async ({ event, step }) => {
    const { messageId, conversationId, projectId, message } =
      event.data as MessageEvent;
    const internalKey = process.env.METEROITE_CONVEX_INTERNAL_KEY;
    if (!internalKey) {
      throw new NonRetriableError("METEROITE_CONVEX_INTERNAL_KEY is not set");
    }
    // TODO: Check if needed
    await step.sleep("wait-for-db-sync", "1s");
    const conversation = await step.run("get-conversation", async () => {
      return await convex.query(api.system.getConversationById, {
        internalKey,
        conversationId,
      });
    });
    if (!conversation) {
      throw new NonRetriableError("Conversation not found");
    }

    // Fetch recent messages for conversation context
    const recentMessages = await step.run("get-recent-messages", async () => {
      return await convex.query(api.system.getRecentMessages, {
        internalKey,
        conversationId,
        limit: 10,
      });
    });

    /** Keep recent history small to limit prompt tokens (last N non-empty turns only). */
    const MAX_HISTORY_MESSAGES = 4;

    // Build system prompt with conversation history (excluding the current message)
    let systemPrompt = CODING_AGENT_SYSTEM_PROMPT;

    // Filter out the current message from the recent messages
    const contextMessages = recentMessages
      .filter((msg) => msg._id !== messageId && msg.content.trim() !== "")
      .slice(-MAX_HISTORY_MESSAGES);
    if (contextMessages.length > 0) {
      const historyText = contextMessages
        .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
        .join("\n\n");
      systemPrompt += `\n\n## Previous (do not repeat verbatim): \n${historyText}\n\n## Current message: answer the user's latest request only.`;
    }

    const reporter = createMessageProgressReporter({
      internalKey,
      messageId,
    });

    await step.run("progress-loaded-context", () => reporter.loadedContext());

    // Generate conversation title if it's still default.
    // Do not call titleAgent.run inside step.run: agent-kit uses step.ai.infer, which
    // nests step tooling and is unsupported (hangs / undefined completion).
    const shouldGenerateTitle =
      conversation.title === DEFAULT_CONVERSATION_TITLE;
    if (shouldGenerateTitle) {
      await step.run("progress-begin-title", () =>
        reporter.beginGeneratingTitle(),
      );
      try {
        const { output } = await titleAgent.run(message);
        const textMessage = output.find(
          (msg) => msg.type === "text" && msg.role === "assistant",
        );
        if (textMessage?.type === "text") {
          const title =
            typeof textMessage.content === "string"
              ? textMessage.content.trim()
              : textMessage.content
                  .map((c) => c.text)
                  .join("")
                  .trim();
          if (title) {
            await step.run("update-conversation-title", async () => {
              await convex.mutation(api.system.updateConversationTitle, {
                internalKey,
                conversationId,
                title,
              });
            });
          }
        }
      } finally {
        await step.run("progress-end-title", () =>
          reporter.endGeneratingTitle(),
        );
      }
    }
    // Passing internal key directly, probably not best practice, works because its validated by previous checks
    await step.run("progress-agent-loop", () =>
      reporter.startAgentLoop({ shouldGenerateTitle }),
    );

    const codingAgent = createAgent({
      name: "meteroite",
      description: "Default Meteroite assistant using OpenRouter MiniMax M2.7",
      system: systemPrompt,
      model: baseModel,
      tools: [
        createListFilesTool({ projectId, internalKey, reporter }),
        createReadFilesTool({ projectId, internalKey, reporter }),
        createUpdateFileTool({ projectId, internalKey, reporter }),
        createCreateFilesTool({ projectId, internalKey, reporter }),
        createCreateFolderTool({ projectId, internalKey, reporter }),
        createDeleteFilesTool({ projectId, internalKey, reporter }),
        createRenameFileTool({ projectId, internalKey, reporter }),
        createScrapeUrlsTool({ reporter }),
      ],
    });

    /** Cap agent loop iterations to reduce token accumulation and latency. */
    const CODING_AGENT_MAX_ITER = 9;

    let lastToolCallFingerprint: string | undefined;
    let duplicateToolCallStreak = 0;

    const network = createNetwork({
      name: "meteroite-network",
      agents: [codingAgent],
      maxIter: CODING_AGENT_MAX_ITER,
      router: ({ network }) => {
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
        return codingAgent;
      },
    });

    const result = await network.run(message);
    const lastResult = result.state.results.at(-1);
    const textMessage = lastResult?.output.find(
      (msg) => msg.type === "text" && msg.role === "assistant",
    );
    let assistantResponse =
      "I processed your request. Let me know if you need anything else.";
    if (textMessage?.type === "text") {
      assistantResponse =
        typeof textMessage.content === "string"
          ? textMessage.content
          : textMessage.content.map((c) => c.text).join("");
    }
    await step.run("progress-finalizing", () => reporter.finalizeResponse());

    await step.run("update-assistant-message", async () => {
      await convex.mutation(api.system.updateMessageContent, {
        internalKey,
        messageId,
        content: assistantResponse,
      });
    });
    return { success: true, messageId, conversationId };
  },
);
