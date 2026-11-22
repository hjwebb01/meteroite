export const CODING_MODELS = [
  { id: "openai/gpt-6-luna", name: "GPT 6 Luna", provider: "openai" },
  {
    id: "deepseek/deepseek-v4.1-flash",
    name: "DeepSeek V4.1 Flash",
    provider: "deepseek",
  },
  { id: "z-ai/glm-5.3-flash", name: "GLM 5.3 Flash", provider: "zai" },
] as const;

type CodingModel = (typeof CODING_MODELS)[number];
type CodingModelId = CodingModel["id"];

export const DEFAULT_CODING_MODEL_ID: CodingModelId = "openai/gpt-6-luna";

export const isCodingModelId = (value: unknown): value is CodingModelId =>
  CODING_MODELS.some((model) => model.id === value);

export const resolveCodingModelId = (value?: string | null): CodingModelId =>
  isCodingModelId(value) ? value : DEFAULT_CODING_MODEL_ID;

export const getCodingModel = (value?: string | null): CodingModel =>
  CODING_MODELS.find((model) => model.id === resolveCodingModelId(value))!;

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
