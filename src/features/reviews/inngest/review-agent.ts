import {
  generateText,
  isStepCount,
  NoObjectGeneratedError,
  Output,
  tool,
  type LanguageModel,
  type ToolSet,
  type ModelMessage,
} from "ai";
import { NonRetriableError } from "inngest";
import type { ChatGPTSelection } from "@/features/chatgpt/lib/types";
import {
  FINAL_INSTRUCTION as REVIEW_GUIDANCE,
  malformedReview,
  runChatGPTReview,
} from "../lib/chatgpt-review";
import {
  assertReviewContext,
  type ReviewBudget,
} from "../lib/context-budget";
import { reviewOutputSchema, type ReviewOutput } from "../lib/review";
import type { ReviewTool } from "../lib/review-tools";

export type ReviewProvider =
  { chatGPT: ChatGPTSelection } | { model: LanguageModel };

const FINAL_INSTRUCTION = `Return the final review. ${REVIEW_GUIDANCE}`;

/**
 * Investigates with read-only tools for up to `maxTurns` turns, then returns
 * the structured review.
 */
export async function runReviewAgent({
  provider,
  system,
  context,
  budget,
  tools,
  maxTurns,
  signal,
  checkActive,
  prepareFindings,
}: {
  provider: ReviewProvider;
  system: string;
  context: string;
  budget: ReviewBudget;
  /** Empty for a tool-free call. */
  tools: ReviewTool[];
  maxTurns: number;
  signal: AbortSignal;
  checkActive: () => Promise<void>;
  prepareFindings: () => Promise<void>;
}): Promise<{ output: ReviewOutput; budgetStopped: boolean }> {
  try {
    return "chatGPT" in provider
      ? await runChatGPTReview({
          selection: provider.chatGPT,
          system,
          context,
          budget,
          maxTurns,
          signal,
          checkActive,
          prepareFindings,
          tools,
        })
      : await runOpenRouterReview({
          model: provider.model,
          system,
          context,
          budget,
          tools,
          maxTurns,
          signal,
          prepareFindings,
        });
  } catch (error) {
    throw error;
  }
}

/** Adapts canonical review tools to AI SDK tools; the SDK validates input before execution. */
function toAiSdkTools(tools: ReviewTool[], signal: AbortSignal): ToolSet {
  return Object.fromEntries(
    tools.map((definition) => [
      definition.name,
      tool({
        description: definition.description,
        inputSchema: definition.parameters,
        execute: (input, options) =>
          definition.execute(input, { callId: options.toolCallId, signal }),
      }),
    ]),
  );
}

async function runOpenRouterReview({
  model,
  system,
  context,
  budget,
  tools,
  maxTurns,
  signal,
  prepareFindings,
}: {
  model: LanguageModel;
  system: string;
  context: string;
  budget: ReviewBudget;
  tools: ReviewTool[];
  maxTurns: number;
  signal: AbortSignal;
  prepareFindings: () => Promise<void>;
}) {
  const checkContext = (messages: ModelMessage[]) => {
    try { assertReviewContext(budget, system, messages); }
    catch (error) { throw new NonRetriableError((error as Error).message); }
  };
  const investigation = maxTurns > 0
    ? await generateText({
        model, system, prompt: context, maxOutputTokens: 6000,
        abortSignal: signal, stopWhen: isStepCount(maxTurns),
        prepareStep: ({ messages }) => { checkContext(messages); return {}; },
        tools: toAiSdkTools(tools, signal),
      })
    : { responseMessages: [] };
  await prepareFindings();
  try {
    const { output } = await generateText({
      model,
      system,
      maxOutputTokens: budget.outputTokens,
      abortSignal: signal,
      output: Output.object({ schema: reviewOutputSchema }),
      prepareStep: ({ messages }) => { checkContext(messages); return {}; },
      messages: [
        { role: "user", content: context },
        ...investigation.responseMessages,
        { role: "user", content: FINAL_INSTRUCTION },
      ],
    });
    return { output, budgetStopped: false };
  } catch (error) {
    if (!NoObjectGeneratedError.isInstance(error)) throw error;
    return { output: malformedReview(), budgetStopped: false };
  }
}
