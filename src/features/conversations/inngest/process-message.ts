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

const titleModel = openai({
  model: OPENROUTER_GPT_5_4_MINI,
  baseUrl: OPENROUTER_OPENAI_BASE_URL,
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultParameters: {
    temperature: 0,
    reasoning: { effort: "low" },
  } as any,
});

const baseModel = openai({
  model: OPENROUTER_GPT_5_4_MINI,
  baseUrl: OPENROUTER_OPENAI_BASE_URL,
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultParameters: {
    temperature: 0.3,
    reasoning: { effort: "medium" },
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

    // Build system prompt with conversation history (excluding the current message)
    let systemPrompt = CODING_AGENT_SYSTEM_PROMPT;

    // Filter out the current message from the recent messages
    const contextMessages = recentMessages.filter(
      (msg) => msg._id !== messageId && msg.content.trim() !== "",
    );
    if (contextMessages.length > 0) {
      const historyText = contextMessages
        .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
        .join("\n\n");
      systemPrompt += `\n\n## Previous Conversation (for context only - do NOT repeat these responses): \n${historyText}\n\n## Current Request: \nRespond ONLY to the user's new message below. Do NOT repeat or reference your previous responses.`;
    }

    await step.run("progress-loaded-context", async () => {
      await convex.mutation(api.system.updateMessageProgress, {
        internalKey,
        messageId,
        progressLabel: "Loaded context",
        progressSteps: [{ label: "Loaded context" }],
      });
    });

    // Generate conversation title if it's still default
    const shouldGenerateTitle =
      conversation.title === DEFAULT_CONVERSATION_TITLE;
    if (shouldGenerateTitle) {
      await step.run("progress-generating-title", async () => {
        await convex.mutation(api.system.updateMessageProgress, {
          internalKey,
          messageId,
          progressLabel: "Generating title",
          progressSteps: [
            { label: "Loaded context" },
            { label: "Generating title" },
          ],
        });
      });
      const { output } = await titleAgent.run(message, { step });
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
    }
    // Passing internal key directly, probably not best practice, works because its validated by previous checks
    const codingAgent = createAgent({
      name: "meteroite",
      description: "Default Meteroite assistant using OpenRouter MiniMax M2.7",
      system: systemPrompt,
      model: baseModel,
      tools: [
        createListFilesTool({ projectId, internalKey }),
        createReadFilesTool({ internalKey }),
        createUpdateFileTool({ internalKey }),
        createCreateFilesTool({ projectId, internalKey }),
        createCreateFolderTool({ projectId, internalKey }),
        createDeleteFilesTool({ internalKey }),
        createRenameFileTool({ internalKey }),
        createScrapeUrlsTool(),
      ],
    });

    const network = createNetwork({
      name: "meteroite-network",
      agents: [codingAgent],
      maxIter: 20,
      router: ({ network }) => {
        const lastResult = network.state.results.at(-1);
        const hasTextResponse = lastResult?.output.some(
          (msg) => msg.type === "text" && msg.role === "assistant",
        );
        const hasToolCall = lastResult?.output.some(
          (msg) => msg.type === "tool_call",
        );
        if (hasTextResponse && !hasToolCall) {
          return undefined;
        }
        return codingAgent;
      },
    });

    await step.run("progress-running-assistant", async () => {
      const progressSteps = [
        { label: "Loaded context" },
        ...(shouldGenerateTitle ? [{ label: "Generating title" }] : []),
        { label: "Running assistant" },
      ];
      await convex.mutation(api.system.updateMessageProgress, {
        internalKey,
        messageId,
        progressLabel: "Running assistant",
        progressSteps,
      });
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
