import { NonRetriableError } from "inngest";
import {
  chatGPTReviewModelId,
  chatGPTReviewSlug,
} from "../../../convex/lib/review_models";
import {
  getChatGPTReviewSelection,
  getChatGPTSelection,
} from "@/features/chatgpt/lib/local-account";
import type { ChatGPTSelection } from "@/features/chatgpt/lib/types";

export type ModelProvider =
  { kind: "chatgpt"; selection: ChatGPTSelection } | { kind: "openrouter" };

const OPENROUTER: ModelProvider = { kind: "openrouter" };

export async function resolveModelProvider(
  userId: string,
  request: Request,
  reviewModel?: string,
): Promise<{ provider: ModelProvider } | { response: Response }> {
  try {
    const slug = reviewModel && chatGPTReviewSlug(reviewModel);
    const selection =
      reviewModel === undefined
        ? await getChatGPTSelection(userId, request)
        : slug
          ? await getChatGPTReviewSelection(userId, request, slug)
          : undefined;
    return {
      provider: selection ? { kind: "chatgpt", selection } : OPENROUTER,
    };
  } catch (error) {
    return {
      response: Response.json(
        {
          error:
            error instanceof Error ? error.message : "Could not use ChatGPT.",
        },
        { status: 400 },
      ),
    };
  }
}

export function modelProviderForReview(
  review: { model: string },
  ownerId: string,
  provider: ModelProvider = OPENROUTER,
): ModelProvider {
  const wantsChatGPT = chatGPTReviewSlug(review.model) !== undefined;
  if (provider.kind === "openrouter") {
    if (wantsChatGPT)
      throw new NonRetriableError(
        "Reconnect ChatGPT and start a new subscription review.",
      );
    return provider;
  }
  if (!wantsChatGPT)
    throw new NonRetriableError(
      "The review provider does not match its selected model.",
    );
  if (
    provider.selection.userId !== ownerId ||
    review.model !== chatGPTReviewModelId(provider.selection.model)
  )
    throw new NonRetriableError(
      "Reconnect ChatGPT and start a new subscription review.",
    );
  return provider;
}
