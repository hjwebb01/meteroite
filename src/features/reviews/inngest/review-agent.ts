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
  ContextBudgetError,
  createReviewContextBudget,
  type ReviewBudget,
} from "../lib/context-budget";
import { reviewOutputSchema, type ReviewOutput } from "../lib/review";
import { mark } from "../lib/timing-temp"; // TIMING-TEMP
import type { ReviewTool } from "../lib/review-tools";

export type ReviewProvider =
  { chatGPT: ChatGPTSelection } | { model: LanguageModel };

const FINAL_INSTRUCTION = `Return the final review. ${REVIEW_GUIDANCE}`;

// TIMING-TEMP experiment: lower reasoning effort to cut output-token latency.
const REVIEW_REASONING = {
  openrouter: { reasoning: { effort: "low" as const } },
};

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
  tools: ReviewTool[];
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
  const contextBudget = createReviewContextBudget({
    budget,
    system,
    context,
    finalInstruction: FINAL_INSTRUCTION,
    limitTurn,
  });
  let allowance = contextBudget.allowance();
  const investigate = maxTurns > 0 && allowance > 0;
  let budgetStopped = maxTurns > 0 && !investigate;
  let lastStepAt = Date.now(); // TIMING-TEMP
  const investigation = investigate
    ? await generateText({
        model,
        system,
        prompt: context,
        maxOutputTokens: 6000,
        abortSignal: signal,
        providerOptions: REVIEW_REASONING,
        stopWhen: [isStepCount(maxTurns), () => budgetStopped],
        onStepEnd: (step) => {
          mark("openrouter-step", {
            ms: Date.now() - lastStepAt,
            calls: step.toolCalls.map((c) => c.toolName),
            usage: step.usage,
          }); // TIMING-TEMP
          lastStepAt = Date.now(); // TIMING-TEMP
          contextBudget.record(step.usage, step.content, step.toolResults);
          allowance = contextBudget.allowance();
          budgetStopped = allowance <= 0 && step.toolCalls.length > 0;
        },
        tools: toAiSdkTools(tools, signal),
      })
    : { responseMessages: [] };
  await prepareFindings();
  contextBudget.prepareFinal();
  try {
    const finalStarted = Date.now(); // TIMING-TEMP
    const { output, usage } = await generateText({
      model,
      system,
      maxOutputTokens: budget.outputTokens,
      abortSignal: signal,
      providerOptions: REVIEW_REASONING,
      output: Output.object({ schema: reviewOutputSchema }),
      messages: [
        { role: "user", content: context },
        ...investigation.responseMessages,
        { role: "user", content: FINAL_INSTRUCTION },
      ],
    });
    mark("openrouter-final", { ms: Date.now() - finalStarted, usage }); // TIMING-TEMP
    return { output, budgetStopped };
  } catch (error) {
    if (!NoObjectGeneratedError.isInstance(error)) throw error;
    return { output: malformedReview(), budgetStopped };
  }
}
