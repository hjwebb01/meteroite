import { inngest } from "@/inngest/client";
import { Id } from "../../../../convex/_generated/dataModel";
import { NonRetriableError } from "inngest";
import { convex } from "@/lib/convex-client";
import { api } from "../../../../convex/_generated/api";

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
        const { messageId } = event.data as MessageEvent;
        const internalKey = process.env.METEROITE_CONVEX_INTERNAL_KEY;
        if (!internalKey) {
            throw new NonRetriableError(
                "METEROITE_CONVEX_INTERNAL_KEY is not set",
            );
        }

        await step.sleep("wait-for-processing", "5 seconds");
        await step.run("update-assistant-message", async () => {
            await convex.mutation(api.system.updateMessageContent, {
                internalKey,
                messageId,
                content: "Assistant message (TODO)",
            });
        });
    },
);
