/**
 * Models users can pick for editor autocomplete. IDs are OpenRouter slugs that
 * support structured output and respond fast enough for inline suggestions.
 * Shared by the client picker and the suggestion route.
 */
export const AUTOCOMPLETE_MODELS = [
  {
    id: "qwen/qwen3-coder-next",
    name: "Qwen3 Coder Next",
    provider: "alibaba",
  },
  {
    id: "deepseek/deepseek-v4.1-flash",
    name: "DeepSeek V4.1 Flash",
    provider: "deepseek",
  },
  { id: "z-ai/glm-5.3-flash", name: "GLM 5.3 Flash", provider: "zai" },
] as const;

export type AutocompleteModel = (typeof AUTOCOMPLETE_MODELS)[number];
export type AutocompleteModelId = AutocompleteModel["id"];

export const DEFAULT_AUTOCOMPLETE_MODEL_ID: AutocompleteModelId =
  "qwen/qwen3-coder-next";

export const AUTOCOMPLETE_MODEL_IDS = AUTOCOMPLETE_MODELS.map(
  (model) => model.id,
) as [AutocompleteModelId, ...AutocompleteModelId[]];

/** Falls back to the default for missing or no-longer-offered model IDs. */
export const resolveAutocompleteModelId = (
  value?: string | null,
): AutocompleteModelId =>
  AUTOCOMPLETE_MODELS.find((model) => model.id === value)?.id ??
  DEFAULT_AUTOCOMPLETE_MODEL_ID;
