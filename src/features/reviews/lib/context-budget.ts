import { countTokens } from "gpt-tokenizer/encoding/o200k_base";
import { chatGPTReviewSlug } from "../../../../convex/lib/review_models";

const OUTPUT_TOKENS = 8_000;
const SCHEMA_RESERVE_TOKENS = 4_000;
const MAX_INPUT_TOKENS = 256_000;
const FALLBACK_CONTEXT_TOKENS = 64_000;
// One investigation turn's output plus tool results the repository reader
// does not meter, such as file listings and changed-line anchors.
const TURN_RESERVE_TOKENS = 16_000;

export type ReviewBudget = {
  contextTokens: number;
  inputTokens: number;
  diffTokens: number;
  repositoryTokens: number;
  outputTokens: number;
  warning?: string;
};

// Modern OpenAI BPE is a closer estimate for source and JSON than byte length.
// Other providers can tokenize differently; keep 15% headroom here and use
// provider-reported usage after each call. Special-token strings in source
// are ordinary text, never control tokens.
export function estimateTokens(text: string) {
  // Bound BPE work on untrusted, repetitive lines. Chunk boundaries may add
  // tokens, which is conservative for the context budget.
  let tokens = 0;
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 4_096, text.length);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
    tokens += countTokens(text.slice(start, end), {
      disallowedSpecial: new Set(),
    });
    start = end;
  }
  return Math.ceil(tokens * 1.15);
}

export function createReviewBudget(
  contextTokens = FALLBACK_CONTEXT_TOKENS,
): ReviewBudget {
  const inputTokens = Math.max(
    0,
    Math.min(
      MAX_INPUT_TOKENS,
      Math.floor(contextTokens * 0.8) - OUTPUT_TOKENS - SCHEMA_RESERVE_TOKENS,
    ),
  );
  return {
    contextTokens,
    inputTokens,
    diffTokens: Math.floor(inputTokens * 0.4),
    repositoryTokens: Math.floor(inputTokens * 0.35),
    outputTokens: OUTPUT_TOKENS,
  };
}

type CatalogModel = { id: string; context_length: number };
let catalogCache: { expires: number; models: CatalogModel[] } | undefined;

export async function loadReviewBudget(modelId: string): Promise<ReviewBudget> {
  try {
    if (!catalogCache || catalogCache.expires <= Date.now()) {
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error("Model catalog unavailable");
      const { data } = (await response.json()) as { data: CatalogModel[] };
      if (!Array.isArray(data)) throw new Error("Invalid model catalog");
      catalogCache = { expires: Date.now() + 3_600_000, models: data };
    }
    // ChatGPT subscription slugs match OpenAI's catalog ids on OpenRouter.
    const slug = chatGPTReviewSlug(modelId);
    const catalogId = slug === undefined ? modelId : `openai/${slug}`;
    const model = catalogCache.models.find((entry) => entry.id === catalogId);
    if (
      !model ||
      !Number.isSafeInteger(model.context_length) ||
      model.context_length <= 0
    )
      throw new Error("Model context size unavailable");
    return createReviewBudget(model.context_length);
  } catch {
    return {
      ...createReviewBudget(),
      warning:
        "The model context size could not be loaded; this review uses a conservative 64,000-token context budget.",
    };
  }
}

/** Thrown when even the final review call cannot fit the model input budget. */
export class ContextBudgetError extends Error {}

export type CallUsage = { inputTokens?: number; outputTokens?: number };

/**
 * Owns one review's context accounting across investigation and final calls.
 * Adapters translate usage and transcript additions; they do not track tokens.
 */
export function createReviewContextBudget({
  budget,
  system,
  context,
  finalInstruction,
  limitTurn,
}: {
  budget: ReviewBudget;
  system: string;
  context: string;
  finalInstruction: string;
  limitTurn?: (tokens: number) => void;
}) {
  let requestTokens = estimateTokens(system) + estimateTokens(context);
  const finalTokens = estimateTokens(finalInstruction);
  const reserve = Math.min(
    TURN_RESERVE_TOKENS,
    Math.floor(budget.inputTokens * 0.15),
  );

  return {
    /** Zero or less stops investigation while retaining room for its final call. */
    allowance() {
      const allowance = budget.inputTokens - requestTokens - reserve;
      if (allowance > 0) limitTurn?.(allowance);
      return allowance;
    },
    /** Record a call's usage and any transcript additions not included in it. */
    record(usage: CallUsage | undefined, output: unknown, appended: unknown) {
      requestTokens =
        (usage?.inputTokens ?? requestTokens) +
        (usage?.outputTokens ?? estimateTokens(JSON.stringify(output))) +
        estimateTokens(JSON.stringify(appended));
    },
    /** An oversized first final call fails; an oversized correction is skipped. */
    prepareFinal(additionalInput?: unknown[]) {
      const tokens =
        requestTokens +
        finalTokens +
        (additionalInput?.length
          ? estimateTokens(JSON.stringify(additionalInput))
          : 0);
      if (tokens <= budget.inputTokens) return true;
      if (additionalInput?.length) return false;
      throw new ContextBudgetError(
        "The review reached its model input budget. Narrow the review scope or select a model with a larger context window.",
      );
    },
  };
}
