export const CHATGPT_REVIEW_PREFIX = "chatgpt:";

export const chatGPTReviewModelId = (slug: string) =>
  `${CHATGPT_REVIEW_PREFIX}${slug}`;

export const isChatGPTReviewModel = (model: string) =>
  /^chatgpt:[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(model);

export const chatGPTReviewSlug = (id: string) =>
  isChatGPTReviewModel(id) ? id.slice(CHATGPT_REVIEW_PREFIX.length) : undefined;

