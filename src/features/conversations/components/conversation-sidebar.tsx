import ky from "ky";
import { toast } from "sonner";
import { memo, useState } from "react";

import { CopyIcon, HistoryIcon, PlusIcon } from "lucide-react";
import { useMonotonicProgressSteps } from "../hooks/use-monotonic-progress-steps";

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
  useSetConversationModel,
} from "../hooks/use-conversations";
import { getProgressViewModel } from "../lib/progress-view-model";

import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import { DEFAULT_CONVERSATION_TITLE } from "../../../../convex/constants";
import {
  DEFAULT_CODING_MODEL_ID,
  resolveCodingModelId,
  type CodingModelId,
} from "../../../../convex/lib/coding-models";
import type { MonotonicProgressStep } from "../hooks/use-monotonic-progress-steps";
import { ConversationModelSelector } from "./conversation-model-selector";
import { PastConversationsDialog } from "./past-conversations-dialog";

/** Mirrors Convex `messages.progressSteps` items (client-safe, no worker imports). */
type ProgressStepRow = MonotonicProgressStep;

function toChainStepStatus(
  step: ProgressStepRow,
  index: number,
  total: number,
  messageStatus: Doc<"messages">["status"],
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
  return messageStatus === "processing" && index === total - 1
    ? "active"
    : "complete";
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
      x.status !== y.status ||
      x.kind !== y.kind ||
      x.toolName !== y.toolName
    ) {
      return false;
    }
  }
  return true;
}

function ProcessingProgressCard({
  activeLabel,
  activeDescription,
  activeIndex,
  totalSteps,
}: {
  activeLabel: string;
  activeDescription?: string;
  activeIndex: number;
  totalSteps: number;
}) {
  return (
    <div
      aria-atomic="true"
      aria-live="polite"
      className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-3 text-sm"
    >
      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-primary/90">
        Current step
      </div>
      <div className="mt-1 text-sm font-medium text-foreground">
        {totalSteps > 0 ? `Step ${activeIndex} of ${totalSteps}` : "Preparing execution"}
      </div>
      <div className="mt-1 text-sm text-foreground">
        {activeLabel}
      </div>
      {activeDescription && (
        <div className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">
          {activeDescription}
        </div>
      )}
    </div>
  );
}

function ProgressTimeline({
  steps,
  messageStatus,
}: {
  steps: ProgressStepRow[];
  messageStatus: Doc<"messages">["status"];
}) {
  return (
    <>
      {steps.map((step, stepIndex, arr) => (
        <ChainOfThoughtStep
          key={step.id ?? `${step.label}-${stepIndex}`}
          description={step.description}
          isLast={stepIndex === arr.length - 1}
          kind={step.kind}
          label={step.label}
          ordinal={stepIndex + 1}
          status={toChainStepStatus(step, stepIndex, arr.length, messageStatus)}
          toolName={step.toolName}
        />
      ))}
    </>
  );
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
  const mergedProgressSteps = useMonotonicProgressSteps(
    message._id,
    message.status,
    message.progressSteps,
  );
  const progressViewModel = getProgressViewModel(
    mergedProgressSteps,
    message.status,
  );
  const activeLabel =
    progressViewModel.activeStep?.label ??
    message.progressLabel ??
    "Working on your response...";
  const activeDescription = progressViewModel.activeStep?.description;
  const showCompletedSummary =
    message.role === "assistant" &&
    message.status === "completed" &&
    mergedProgressSteps.length > 0;

  return (
    <Message from={message.role}>
      <MessageContent>
        {message.status === "processing" ? (
          <div className="space-y-3">
            <ProcessingProgressCard
              activeDescription={activeDescription}
              activeIndex={progressViewModel.activeIndex}
              activeLabel={activeLabel}
              totalSteps={progressViewModel.totalSteps}
            />
            {mergedProgressSteps.length > 0 && (
              <ChainOfThought defaultOpen={true}>
                <ChainOfThoughtHeader>Execution trace</ChainOfThoughtHeader>
                <ChainOfThoughtContent animateContent={false}>
                  <ProgressTimeline
                    messageStatus={message.status}
                    steps={mergedProgressSteps}
                  />
                </ChainOfThoughtContent>
              </ChainOfThought>
            )}
          </div>
        ) : message.status === "cancelled" ? (
          <div className="text-muted-foreground italic">
            <span>Message cancelled</span>
          </div>
        ) : (
          <div className="space-y-3">
            <MessageResponse>{message.content}</MessageResponse>
            {showCompletedSummary && (
              <ChainOfThought defaultOpen={false}>
                <ChainOfThoughtHeader>
                  <>
                    <span className="font-medium text-foreground">
                      {progressViewModel.summaryTitle}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {progressViewModel.summarySubtitle}
                    </span>
                  </>
                </ChainOfThoughtHeader>
                <ChainOfThoughtContent animateContent={false}>
                  <ProgressTimeline
                    messageStatus={message.status}
                    steps={mergedProgressSteps}
                  />
                </ChainOfThoughtContent>
              </ChainOfThought>
            )}
          </div>
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
  // Choice made before a conversation exists; new conversations start from it.
  const [draftModel, setDraftModel] = useState<CodingModelId>(
    DEFAULT_CODING_MODEL_ID,
  );

  const createConversation = useCreateConversation();
  const setConversationModel = useSetConversationModel();
  const conversations = useConversations(projectId);
  const activeConversationId =
    selectedConversationId ?? conversations?.[0]?._id ?? null;

  const activeConversation = useConversation(activeConversationId);
  const conversationMessages = useMessages(activeConversationId);

  const selectedModel = activeConversationId
    ? resolveCodingModelId(activeConversation?.model)
    : draftModel;

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
        model: selectedModel,
      });
      setSelectedConversationId(newConversationId);
      return newConversationId;
    } catch {
      toast.error("Failed to create conversation");
      return null;
    }
  };

  const handleModelChange = async (model: CodingModelId) => {
    setDraftModel(model);
    if (!activeConversationId) {
      return;
    }
    try {
      await setConversationModel({ id: activeConversationId, model });
    } catch {
      toast.error("Failed to change model");
    }
  };

  const handleSubmit = async (message: PromptInputMessage) => {
    if (isProcessing && !message.text) {
      await handleCancel();
      setInput("");
      return;
    }
    let conversationId = activeConversationId;
    // An unloaded conversation's stored model is unknown, so let the server use it.
    let model: CodingModelId | undefined = activeConversation
      ? selectedModel
      : undefined;

    if (!conversationId) {
      model = selectedModel;
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
          model,
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
              <PromptInputTools>
                <ConversationModelSelector
                  value={selectedModel}
                  onValueChange={handleModelChange}
                />
              </PromptInputTools>
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
