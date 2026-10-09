import {
  generateText,
  isStepCount,
  NoObjectGeneratedError,
  Output,
  tool,
  type LanguageModel,
  type ToolSet,
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
  ContextBudgetError,
  estimateTokens,
  nextRequestTokens,
  turnAllowance,
  type ReviewBudget,
} from "../lib/context-budget";
import { reviewOutputSchema, type ReviewOutput } from "../lib/review";
import type { ReviewTool } from "../lib/review-tools";

export type ReviewProvider =
  { chatGPT: ChatGPTSelection } | { model: LanguageModel };

const FINAL_INSTRUCTION = `Return the final review. ${REVIEW_GUIDANCE}`;

/**
 * Investigates with read-only tools for up to `maxTurns` turns, then returns
 * the structured review. Each turn is metered from provider-reported usage;
 * when another turn could crowd out the final call, investigation stops and
 * the review proceeds with partial coverage instead of failing.
 */
export async function runReviewAgent({
  provider,
  system,
  context,
  budget,
  tools,
  limitTurn,
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
  /** Caps repository tokens the coming turn's tools may deliver. */
  limitTurn?: (tokens: number) => void;
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
          limitTurn,
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
          limitTurn,
          maxTurns,
          signal,
          prepareFindings,
        });
  } catch (error) {
    if (error instanceof ContextBudgetError)
      throw new NonRetriableError(error.message);
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
  limitTurn,
  maxTurns,
  signal,
  prepareFindings,
}: {
  model: LanguageModel;
  system: string;
  context: string;
  budget: ReviewBudget;
  tools: ReviewTool[];
  limitTurn?: (tokens: number) => void;
  maxTurns: number;
  signal: AbortSignal;
  prepareFindings: () => Promise<void>;
}) {
  let requestTokens = estimateTokens(system) + estimateTokens(context);
  let allowance = turnAllowance(budget, requestTokens);
  const investigate = maxTurns > 0 && allowance > 0;
  let budgetStopped = maxTurns > 0 && !investigate;
  limitTurn?.(allowance);
  const investigation = investigate
    ? await generateText({
        model,
        system,
        prompt: context,
        maxOutputTokens: 6000,
        abortSignal: signal,
        stopWhen: [isStepCount(maxTurns), () => budgetStopped],
        onStepEnd: (step) => {
          requestTokens = nextRequestTokens(
            requestTokens,
            step.usage,
            step.content,
            step.toolResults,
          );
          allowance = turnAllowance(budget, requestTokens);
          // A step without tool calls ends the investigation on its own.
          budgetStopped = allowance <= 0 && step.toolCalls.length > 0;
          limitTurn?.(allowance);
        },
        tools: toAiSdkTools(tools, signal),
      })
    : { responseMessages: [] };
  await prepareFindings();
  assertReviewContext(
    budget,
    requestTokens + estimateTokens(FINAL_INSTRUCTION),
  );
  try {
    const { output } = await generateText({
      model,
      system,
      maxOutputTokens: budget.outputTokens,
      abortSignal: signal,
      output: Output.object({ schema: reviewOutputSchema }),
      messages: [
        { role: "user", content: context },
        ...investigation.responseMessages,
        { role: "user", content: FINAL_INSTRUCTION },
      ],
    });
    return { output, budgetStopped };
  } catch (error) {
    if (!NoObjectGeneratedError.isInstance(error)) throw error;
    return { output: malformedReview(), budgetStopped };
  }
}
