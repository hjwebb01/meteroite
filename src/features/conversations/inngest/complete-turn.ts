import { getConvexAdminClient } from "@/lib/convex-client";
import { internal } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { Step } from "./chatgpt-agent";
import type { AgentResultLike } from "./conversation-history";
import { isEmptySummary, summarizeTurn } from "./conversation-history";
import type { MessageProgressReporter } from "./message-progress";

/** What every turn executor returns, whatever provider produced it. */
export interface TurnResult {
  text: string;
  results: AgentResultLike[];
}

/** Finalize progress and persist the assistant reply, shared by every provider. */
export async function completeTurn({
  step,
  reporter,
  messageId,
  turn,
}: {
  step: Step;
  reporter: Pick<MessageProgressReporter, "finalizeResponse">;
  messageId: Id<"messages">;
  turn: TurnResult;
}) {
  await step.run("progress-finalizing", () => reporter.finalizeResponse());
  const turnSummary = summarizeTurn(turn.results);
  await step.run("update-assistant-message", () =>
    getConvexAdminClient().mutation(
      internal.systemMessages.updateMessageContent,
      {
        messageId,
        content: turn.text,
        ...(isEmptySummary(turnSummary) ? {} : { turnSummary }),
      },
    ),
  );
}
