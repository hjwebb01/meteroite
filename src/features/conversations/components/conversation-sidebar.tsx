import ky from "ky";
import { toast } from "sonner";
import { memo, useState } from "react";
import { CopyIcon, HistoryIcon, PlusIcon } from "lucide-react";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";

import {
  Message,
  MessageContent,
  MessageResponse,
  MessageActions,
  MessageAction,
} from "@/components/ai-elements/message";

import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";

import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";

import { Button } from "@/components/ui/button";
import {
  useConversation,
  useConversations,
  useCreateConversation,
  useMessages,
} from "../hooks/use-conversations";

import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { DEFAULT_CONVERSATION_TITLE } from "../../../../convex/constants";
import { PastConversationsDialog } from "./past-conversations-dialog";

/** Mirrors Convex `messages.progressSteps` items (client-safe, no worker imports). */
type ProgressStepRow = {
  id?: string;
  label: string;
  description?: string;
  status?: "pending" | "active" | "complete" | "error";
};

function toChainStepStatus(
  step: ProgressStepRow,
  index: number,
  total: number,
): "complete" | "active" | "pending" | "error" {
  if (step.status === "error") {
    return "error";
  }
  if (step.status === "active") {
    return "active";
  }
  if (step.status === "pending") {
    return "pending";
  }
  if (step.status === "complete") {
    return "complete";
  }
  return index === total - 1 ? "active" : "complete";
}

function progressStepsEqual(
  a: Doc<"messages">["progressSteps"],
  b: Doc<"messages">["progressSteps"],
): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return a === b;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (
      x.id !== y.id ||
      x.label !== y.label ||
      x.description !== y.description ||
      x.status !== y.status
    ) {
      return false;
    }
  }
  return true;
}

function messagePropsEqualForSidebar(
  a: Doc<"messages">,
  b: Doc<"messages">,
): boolean {
  return (
    a._id === b._id &&
    a.role === b.role &&
    a.status === b.status &&
    a.content === b.content &&
    a.progressLabel === b.progressLabel &&
    progressStepsEqual(a.progressSteps, b.progressSteps)
  );
}

type SidebarMessageRowProps = {
  message: Doc<"messages">;
  messageIndex: number;
  totalMessages: number;
};

const ConversationSidebarMessage = memo(function ConversationSidebarMessage({
  message,
  messageIndex,
  totalMessages,
}: SidebarMessageRowProps) {
  return (
    <Message from={message.role}>
      <MessageContent>
        {message.status === "processing" ? (
          <div className="space-y-3 text-muted-foreground">
            <Shimmer
              as="p"
              className="text-sm"
            >
              {message.progressLabel ??
                message.progressSteps?.at(-1)?.label ??
                "Working on your response..."}
            </Shimmer>
            {message.progressSteps && message.progressSteps.length > 0 && (
              <ChainOfThought defaultOpen={true}>
                <ChainOfThoughtHeader>Progress</ChainOfThoughtHeader>
                <ChainOfThoughtContent>
                  {message.progressSteps.map((step, stepIndex, arr) => (
                    <ChainOfThoughtStep
                      key={step.id ?? `${step.label}-${stepIndex}`}
                      label={step.label}
                      description={step.description}
                      status={toChainStepStatus(step, stepIndex, arr.length)}
                    />
                  ))}
                </ChainOfThoughtContent>
              </ChainOfThought>
            )}
          </div>
        ) : message.status === "cancelled" ? (
          <div className="text-muted-foreground italic">
            <span>Message cancelled</span>
          </div>
        ) : (
          <MessageResponse>{message.content}</MessageResponse>
        )}
      </MessageContent>
      {message.role === "assistant" &&
        message.status === "completed" &&
        messageIndex === totalMessages - 1 && (
          <MessageActions>
            <MessageAction
              onClick={() => {
                navigator.clipboard.writeText(message.content);
              }}
              label="Copy"
            >
              <CopyIcon className="size-3" />
            </MessageAction>
          </MessageActions>
        )}
    </Message>
  );
}, (prev, next) => {
  return (
    messagePropsEqualForSidebar(prev.message, next.message) &&
    prev.messageIndex === next.messageIndex &&
    prev.totalMessages === next.totalMessages
  );
});

ConversationSidebarMessage.displayName = "ConversationSidebarMessage";

interface ConversationSidebarProps {
  projectId: Id<"projects">;
}

export const ConversationSideBar = ({
  projectId,
}: ConversationSidebarProps) => {
  const [input, setInput] = useState("");
  const [selectedConversationId, setSelectedConversationId] =
    useState<Id<"conversations"> | null>(null);
  const [pastConversationsOpen, setPastConversationsOpen] = useState(false);

  const createConversation = useCreateConversation();
  const conversations = useConversations(projectId);
  const activeConversationId =
    selectedConversationId ?? conversations?.[0]?._id ?? null;

  const activeConversation = useConversation(activeConversationId);
  const conversationMessages = useMessages(activeConversationId);

  const isProcessing = conversationMessages?.some(
    (msg) => msg.status === "processing",
  );

  const handleCancel = async () => {
    try {
      await ky.post("/api/messages/cancel", {
        json: {
          projectId,
        },
      });
    } catch {
      toast.error("Failed to cancel messages");
    }
  };

  const handleCreateConversation = async () => {
    try {
      const newConversationId = await createConversation({
        projectId,
        title: DEFAULT_CONVERSATION_TITLE,
      });
      setSelectedConversationId(newConversationId);
      return newConversationId;
    } catch {
      toast.error("Failed to create conversation");
      return null;
    }
  };

  const handleSubmit = async (message: PromptInputMessage) => {
    if (isProcessing && !message.text) {
      await handleCancel();
      setInput("");
      return;
    }
    let conversationId = activeConversationId;

    if (!conversationId) {
      conversationId = await handleCreateConversation();
      if (!conversationId) {
        return;
      }
    }

    try {
      await ky.post("/api/messages", {
        json: {
          conversationId,
          message: message.text,
        },
      });
    } catch {
      toast.error("Failed to send message");
    }
    setInput("");
  };
  return (
    <>
      <PastConversationsDialog
        projectId={projectId}
        open={pastConversationsOpen}
        onOpenChange={setPastConversationsOpen}
        onSelect={setSelectedConversationId}
      />
      <div className="flex flex-col h-full bg-sidebar">
        <div className="h-8.75 flex items-center justify-between border-b">
          <div className="text-sm truncate pl-3">
            {activeConversation?.title ?? DEFAULT_CONVERSATION_TITLE}
          </div>
          <div className="flex items-center px-1 gap-1">
            <Button
              size="icon-xs"
              variant="highlight"
              onClick={() => setPastConversationsOpen(true)}
            >
              <HistoryIcon className="size-3.5" />
            </Button>
            <Button
              size="icon-xs"
              variant="highlight"
              onClick={handleCreateConversation}
            >
              <PlusIcon className="size-3.5" />
            </Button>
          </div>
        </div>
        <Conversation className="flex-1">
          <ConversationContent>
            {conversationMessages?.map((message, messageIndex) => (
              <ConversationSidebarMessage
                key={message._id}
                message={message}
                messageIndex={messageIndex}
                totalMessages={conversationMessages.length}
              />
            ))}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
        <div className="p-3">
          <PromptInput
            onSubmit={handleSubmit}
            className="mt-2"
          >
            <PromptInputBody>
              <PromptInputTextarea
                placeholder="Ask me anything..."
                onChange={(e) => setInput(e.target.value)}
                value={input}
                disabled={isProcessing}
              />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools />
              <PromptInputSubmit
                disabled={isProcessing ? false : !input}
                status={isProcessing ? "streaming" : undefined}
              />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </>
  );
};
