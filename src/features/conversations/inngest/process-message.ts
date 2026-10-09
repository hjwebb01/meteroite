import { inngest } from "@/inngest/client";
import { Id } from "../../../../convex/_generated/dataModel";
import { NonRetriableError } from "inngest";
import { getConvexAdminClient } from "@/lib/convex-client";
import { internal } from "../../../../convex/_generated/api";
import { DEFAULT_CONVERSATION_TITLE } from "../../../../convex/constants";
import { createMessageProgressReporter } from "./message-progress";
import type { ModelProvider } from "@/features/model-provider/model-provider";
import { selectHistoryTurns } from "./conversation-history";
import {
  CHATGPT_PROVIDER_ERROR_NAME,
  createTurnExecutor,
} from "./turn-executors";
import { completeTurn } from "./complete-turn";

/** Messages fetched per turn; the token budget decides how many actually reach the prompt. */
const HISTORY_FETCH_LIMIT = 40;

interface MessageEvent {
  /** Assistant placeholder message (processing → completed). */
  messageId: Id<"messages">;
  /** User message for this turn; excluded from system history (same text as `network.run(message)`). */
  userMessageId?: Id<"messages">;
  conversationId: Id<"conversations">;
  projectId: Id<"projects">;
  message: string;
  /** Snapshot of the conversation model at submission time. */
  model?: string;
  /** Absent on events queued before Model providers; those use OpenRouter. */
  provider?: ModelProvider;
}

export const processMessage = inngest.createFunction(
  {
    id: "process-message",
    triggers: { event: "message/sent" },
    cancelOn: [
      {
        event: "message/cancel",
        if: "event.data.messageId == async.data.messageId",
      },
    ],
    onFailure: async ({ event, step }) => {
      const { messageId, provider } = event.data.event.data as MessageEvent;

      const deployKey = process.env.CONVEX_DEPLOY_KEY;
      if (deployKey) {
        await step.run("update-message-on-failure", async () => {
          await getConvexAdminClient().mutation(
            internal.systemMessages.updateMessageContent,
            {
              messageId,
              content:
                provider?.kind !== "chatgpt"
                  ? "Failed to generate assistant message"
                  : event.data.error.name === CHATGPT_PROVIDER_ERROR_NAME
                    ? `ChatGPT request failed: ${event.data.error.message}`
                    : "ChatGPT could not finish this request. Try again.",
            },
          );
        });
      }
    },
  },
  async ({ event, step }) => {
    const {
      messageId,
      userMessageId,
      conversationId,
      projectId,
      message,
      model,
      provider = { kind: "openrouter" },
    } = event.data as MessageEvent;
    const deployKey = process.env.CONVEX_DEPLOY_KEY;
    if (!deployKey) {
      throw new NonRetriableError("CONVEX_DEPLOY_KEY is not set");
    }
    const conversation = await step.run("get-conversation", async () => {
      return await getConvexAdminClient().query(
        internal.systemMessages.getConversationById,
        {
          conversationId,
        },
      );
    });
    if (!conversation) {
      throw new NonRetriableError("Conversation not found");
    }

    const selectedModel = model ?? conversation.model;

    // Load messages + first progress update in one step (single Convex round-trip;
    // a separate step here was prone to stalling between query and progress mutation).
    const recentMessages = await step.run(
      "load-conversation-context",
      async () => {
        const messages = await getConvexAdminClient().query(
          internal.systemMessages.getRecentMessages,
          {
            conversationId,
            limit: HISTORY_FETCH_LIMIT,
          },
        );
        await getConvexAdminClient().mutation(
          internal.systemMessages.updateMessageProgress,
          {
            messageId,
            progressLabel: "Loaded context",
            progressSteps: [
              {
                id: "phase-loaded",
                label: "Loaded context",
                status: "complete",
                kind: "phase",
              },
            ],
          },
        );
        return messages;
      },
    );

    const userMessageIdToExclude =
      userMessageId ??
      recentMessages
        .filter((m) => m.role === "user" && m.content === message)
        .at(-1)?._id;

    // Prior turns replay as real chat messages (assistant turns carry their tool
    // activity summary), chosen newest-first under a token budget.
    const historyTurns = selectHistoryTurns(recentMessages, {
      excludeIds: new Set(
        [messageId, userMessageIdToExclude].filter(
          (id): id is Id<"messages"> => id !== undefined,
        ),
      ),
    });

    const reporter = createMessageProgressReporter({
      messageId,
    });
    reporter.seedLoadedContextState();

    const executor = createTurnExecutor({
      provider,
      model: selectedModel,
      step,
      projectId,
      reporter,
      historyTurns,
    });

    // Generate conversation title if it's still default.
    const shouldGenerateTitle =
      conversation.title === DEFAULT_CONVERSATION_TITLE;
    if (shouldGenerateTitle) {
      await step.run("progress-begin-title", async () => {
        await reporter.beginGeneratingTitle();
      });
      try {
        const title = (
          await executor.generateTitle(message).catch((error) => {
            throw executor.failure(error, "title");
          })
        ).trim();
        if (title) {
          await step.run("update-conversation-title", async () => {
            await getConvexAdminClient().mutation(
              internal.systemMessages.updateConversationTitle,
              {
                conversationId,
                title,
              },
            );
          });
        }
      } finally {
        await step.run("progress-end-title", async () => {
          await reporter.endGeneratingTitle();
        });
      }
    }
    await step.run("progress-agent-loop", async () => {
      await reporter.startAgentLoop({ shouldGenerateTitle });
    });

    const turn = await executor.runTurn(message).catch((error) => {
      throw executor.failure(error, "turn");
    });
    await completeTurn({ step, reporter, messageId, turn });
    return { success: true, messageId, conversationId };
  },
);
