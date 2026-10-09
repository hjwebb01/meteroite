import { CODING_MODELS, isCodingModelId } from "./coding_models.ts";

export const REVIEW_MODELS = [
  ...CODING_MODELS,
  { id: "openai/gpt-5.3-codex", name: "GPT-5.3 Codex" },
  { id: "openai/gpt-5.2-codex", name: "GPT-5.2 Codex" },
  { id: "openai/gpt-5.1-codex-max", name: "GPT-5.1 Codex Max" },
  { id: "openai/gpt-5.1-codex", name: "GPT-5.1 Codex" },
  { id: "openai/gpt-5.1-codex-mini", name: "GPT-5.1 Codex Mini" },
] as const;

export const CHATGPT_REVIEW_PREFIX = "chatgpt:";

export const chatGPTReviewModelId = (slug: string) =>
  `${CHATGPT_REVIEW_PREFIX}${slug}`;

export const isChatGPTReviewModel = (model: string) =>
  /^chatgpt:[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(model);

export const chatGPTReviewSlug = (id: string) =>
  isChatGPTReviewModel(id) ? id.slice(CHATGPT_REVIEW_PREFIX.length) : undefined;

export const isReviewModelId = (value: unknown): value is string =>
  typeof value === "string" &&
  (isCodingModelId(value) ||
    REVIEW_MODELS.some((m) => m.id === value) ||
    isChatGPTReviewModel(value));
