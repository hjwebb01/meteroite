import { runToolLoop } from "@/features/chatgpt/lib/tool-loop";
import type { ChatGPTSelection } from "@/features/chatgpt/lib/types";
import { reviewOutputSchema, type ReviewOutput } from "./review";
import { createReviewContextBudget, type ReviewBudget } from "./context-budget";
import type { ReviewTool } from "./review-tools";

export const FINAL_INSTRUCTION =
  "Return one complete review object with all six fields: assessment, hotspots, changeGroups, summary, findings, and limitations. Assessment alone is invalid. Empty arrays are allowed; use limitations to report scope gaps. Include only findings supported by the inspected code, and list anything that needs execution to verify.";

/** Stands in for a final review whose structure is unusable; coverage is kept by the caller. */
export function malformedReview(): ReviewOutput {
  const reason = "The model's final review was malformed and was discarded.";
  return {
    assessment: { state: "incomplete", missingEvidence: [reason] },
    hotspots: [],
    changeGroups: [],
    summary: "The review could not be completed.",
    findings: [],
    limitations: [reason],
  };
}

/**
 * Investigation ends early, rather than failing, when another turn could
 * leave no room for the final review call.
 */
export async function runChatGPTReview({
  selection,
  system,
  context,
  tools,
  budget,
  maxTurns = 8,
  limitTurn,
  signal,
  checkActive,
  prepareFindings,
}: {
  selection: ChatGPTSelection;
  system: string;
  context: string;
  tools: ReviewTool[];
  budget: ReviewBudget;
  maxTurns?: number;
  /** Caps repository tokens the coming turn's tools may deliver. */
  limitTurn?: (tokens: number) => void;
  signal: AbortSignal;
  checkActive: () => Promise<void>;
  prepareFindings: () => Promise<void>;
}) {
  const instruction = `Call return_review with the final review. ${FINAL_INSTRUCTION}`;
  const contextBudget = createReviewContextBudget({
    budget,
    system,
    context,
    finalInstruction: instruction,
    limitTurn,
  });
  const { value, budgetStopped } = await runToolLoop<ReviewOutput>({
    selection,
    instructions: system,
    input: [{ role: "user", content: context }],
    toolset: "Read-only repository review tools.",
    tools: tools.map((tool) => ({
      ...tool,
      execute: (args, call) => tool.execute(args, { ...call, signal }),
    })),
    maxTurns,
    signal,
    beforeCall: checkActive,
    budget: {
      allowance: contextBudget.allowance,
      record: (response, results) => {
        contextBudget.record(
          {
            inputTokens: response.usage?.input_tokens,
            outputTokens: response.usage?.output_tokens,
          },
          response.output,
          results,
        );
      },
    },
    finish: {
      kind: "structured",
      name: "return_review",
      description: "Return final findings and assessment.",
      schema: reviewOutputSchema,
      instruction,
      maxAttempts: 2,
      before: async (additionalInput) => {
        await prepareFindings();
        return contextBudget.prepareFinal(additionalInput);
      },
    },
  });
  return { output: value ?? malformedReview(), budgetStopped };
}
