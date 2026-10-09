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

// A byte per token is deliberately conservative across providers, including
// punctuation-heavy code and Unicode. JSON escaping is counted by callers.
export function estimateTokens(text: string) {
  return Buffer.byteLength(text, "utf8");
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
 * Size of the next request in a tool loop: the provider-reported size of the
 * previous call plus its output and the tool results appended after it. Falls
 * back to estimates for anything the provider does not report.
 */
export function nextRequestTokens(
  previous: number,
  usage: CallUsage | undefined,
  output: unknown,
  appended: unknown,
) {
  return (
    (usage?.inputTokens ?? previous) +
    (usage?.outputTokens ?? estimateTokens(JSON.stringify(output))) +
    estimateTokens(JSON.stringify(appended))
  );
}

/**
 * Repository tokens the next investigation turn may add while leaving room
 * for that turn's own output and the final review call. Zero or less means
 * the investigation should stop.
 */
export function turnAllowance(budget: ReviewBudget, requestTokens: number) {
  const reserve = Math.min(
    TURN_RESERVE_TOKENS,
    Math.floor(budget.inputTokens * 0.15),
  );
  return budget.inputTokens - requestTokens - reserve;
}

export function assertReviewContext(
  budget: ReviewBudget,
  requestTokens: number,
) {
  if (requestTokens > budget.inputTokens)
    throw new ContextBudgetError(
      "The review reached its model input budget. Narrow the review scope or select a model with a larger context window.",
    );
}
