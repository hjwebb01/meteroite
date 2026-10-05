/**
 * Models users can pick for the coding agent. IDs are OpenRouter slugs that
 * support tool calling and reasoning. Shared by Convex (validation), the API
 * route, the worker, and the sidebar, so it must stay free of runtime imports.
 */
export const CODING_MODELS = [
  { id: "openai/gpt-6-luna", name: "GPT 6 Luna", provider: "openai" },
  {
    id: "deepseek/deepseek-v4.1-flash",
    name: "DeepSeek V4.1 Flash",
    provider: "deepseek",
  },
  { id: "z-ai/glm-5.3-flash", name: "GLM 5.3 Flash", provider: "zai" },
] as const;

export type CodingModel = (typeof CODING_MODELS)[number];
export type CodingModelId = CodingModel["id"];

export const DEFAULT_CODING_MODEL_ID: CodingModelId = "openai/gpt-6-luna";

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
