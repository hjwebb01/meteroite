import { runToolLoop } from "@/features/chatgpt/lib/tool-loop";
import type { ChatGPTSelection } from "@/features/chatgpt/lib/types";
import { reviewOutputSchema, type ReviewOutput } from "./review";
import {
  assertReviewContext,
  type ReviewBudget,
} from "./context-budget";
import type { ReviewTool } from "./review-tools";

export const FINAL_INSTRUCTION =
  "Include only findings supported by the inspected code. List important limitations, including anything that needs execution to verify.";

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
  signal: AbortSignal;
  checkActive: () => Promise<void>;
  prepareFindings: () => Promise<void>;
}) {
  const instruction = `Call return_review with the final review. ${FINAL_INSTRUCTION}`;
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
    finish: {
      kind: "structured",
      name: "return_review",
      description: "Return final findings and assessment.",
      schema: reviewOutputSchema,
      instruction,
      before: async () => {
        await prepareFindings();
        assertReviewContext(budget, system, [{ role: "user", content: context + instruction }]);
      },
    },
  });
  return { output: value ?? malformedReview(), budgetStopped };
}
