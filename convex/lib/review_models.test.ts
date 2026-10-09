import { expect, test } from "vitest";
import {
  chatGPTReviewModelId,
  chatGPTReviewSlug,
  isChatGPTReviewModel,
} from "./review_models.ts";

test("ChatGPT review model ids round-trip through their slug", () => {
  const id = chatGPTReviewModelId("gpt-5.3-codex");
  expect(isChatGPTReviewModel(id)).toBe(true);
  expect(chatGPTReviewSlug(id)).toBe("gpt-5.3-codex");
  expect(chatGPTReviewSlug("openai/gpt-5.3-codex")).toBeUndefined();
  expect(chatGPTReviewSlug("chatgpt:")).toBeUndefined();
});
