import { openai } from "@inngest/agent-kit";
import {
  resolveCodingModelId,
  type CodingModelId,
} from "../../../../convex/lib/coding-models";
import { OPENROUTER_OPENAI_BASE_URL, TITLE_GENERATOR_MODEL } from "./constants";

const createOpenRouterModel = (
  model: string,
  parameters: Record<string, unknown>,
) =>
  openai({
    model,
    baseUrl: OPENROUTER_OPENAI_BASE_URL,
    apiKey: process.env.OPENROUTER_API_KEY,
    // OpenRouter extended params (reasoning) are not in the default typings.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    defaultParameters: parameters as any,
  });

/**
 * Model for the coding agent. Every selectable model is a reasoning model, and
 * the GPT-5 family rejects `temperature` upstream, so only reasoning is set.
 */
export const createCodingModel = (modelId?: string | null) =>
  createOpenRouterModel(resolveCodingModelId(modelId), {
    reasoning: { effort: "low" },
  });

export const createTitleModel = () =>
  createOpenRouterModel(TITLE_GENERATOR_MODEL, {
    reasoning: { effort: "low" },
  });

export type { CodingModelId };
