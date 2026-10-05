/**
 * Models users can pick for the coding agent. IDs are OpenRouter slugs that
 * support tool calling and reasoning. Shared by Convex (validation), the API
 * route, the worker, and the sidebar, so it must stay free of runtime imports.
 */
export const CODING_MODELS = [
  { id: "openai/gpt-5.4-mini", name: "GPT-5.4 Mini", provider: "openai" },
  { id: "openai/gpt-5.4", name: "GPT-5.4", provider: "openai" },
  {
    id: "anthropic/claude-sonnet-5.5",
    name: "Claude Sonnet 5.5",
    provider: "anthropic",
  },
  {
    id: "anthropic/claude-opus-5.5",
    name: "Claude Opus 5.5",
    provider: "anthropic",
  },
  {
    id: "google/gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    provider: "google",
  },
  {
    id: "deepseek/deepseek-v4.1-flash",
    name: "DeepSeek V4.1 Flash",
    provider: "deepseek",
  },
  { id: "moonshotai/kimi-k3", name: "Kimi K3", provider: "moonshotai" },
  { id: "z-ai/glm-5.3", name: "GLM 5.3", provider: "zai" },
] as const;

export type CodingModel = (typeof CODING_MODELS)[number];
export type CodingModelId = CodingModel["id"];

export const DEFAULT_CODING_MODEL_ID: CodingModelId = "openai/gpt-5.4-mini";

export const isCodingModelId = (value: unknown): value is CodingModelId =>
  CODING_MODELS.some((model) => model.id === value);

/** Falls back to the default for missing or no-longer-offered model IDs. */
export const resolveCodingModelId = (value?: string | null): CodingModelId =>
  isCodingModelId(value) ? value : DEFAULT_CODING_MODEL_ID;

export const getCodingModel = (value?: string | null): CodingModel =>
  CODING_MODELS.find((model) => model.id === resolveCodingModelId(value))!;

/** Throws for IDs outside the selectable list; `undefined` means "no choice". */
export const assertCodingModelId = (
  value: string | undefined,
): CodingModelId | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!isCodingModelId(value)) {
    throw new Error(`Unsupported model: ${value}`);
  }
  return value;
};
