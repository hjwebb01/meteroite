import OpenAI from "openai";
import { z } from "zod";
import type {
  Response,
  ResponseCreateParamsStreaming,
} from "openai/resources/responses/responses";
import { getChatGPTCredentials } from "./local-account";
import type { ChatGPTSelection } from "./types";

export function chatGPTError(code?: string | null) {
  if (
    code === "subscription_sharing_usage_limit_exceeded" ||
    code === "subscription_sharing_usage_unavailable"
  ) {
    return "ChatGPT plan usage is unavailable or its limit has been reached. Check ChatGPT Settings → Usage, or select OpenRouter in provider settings.";
  }
  return "ChatGPT could not complete this request. Check your connection and available plan usage, then try again.";
}

/** Non-strict: schemas Zod emits are not guaranteed to satisfy strict mode. */
export function functionDefinition(
  name: string,
  description: string | undefined,
  parameters: z.ZodType,
  options?: Parameters<typeof z.toJSONSchema>[1],
) {
  return {
    type: "function" as const,
    name,
    description,
    parameters: z.toJSONSchema(parameters, options),
    strict: false,
  };
}

export function functionNamespace(
  description: string,
  tools: ReturnType<typeof functionDefinition>[],
) {
  return { type: "namespace" as const, name: "meteroite", description, tools };
}

export async function completeChatGPTResponse(
  selection: ChatGPTSelection,
  parameters: Pick<
    ResponseCreateParamsStreaming,
    "input" | "instructions" | "tools" | "tool_choice"
  >,
  options?: { signal?: AbortSignal },
): Promise<Response> {
  const accessToken = await getChatGPTCredentials(selection);
  const client = new OpenAI({
    apiKey: accessToken,
    baseURL: "https://api.openai.com/v1",
    maxRetries: 0,
    timeout: 120_000,
  });
  try {
    const stream = await client.responses.create(
      {
        ...parameters,
        model: selection.model,
        store: false,
        stream: true,
        include: ["reasoning.encrypted_content"],
      },
      options,
    );
    let completed: Response | undefined;
    for await (const event of stream) {
      if (event.type === "response.completed") completed = event.response;
      if (event.type === "response.failed")
        throw new Error(chatGPTError(event.response.error?.code));
      if (event.type === "response.incomplete" || event.type === "error")
        throw new Error(
          chatGPTError(event.type === "error" ? event.code : undefined),
        );
    }
    if (!completed)
      throw new Error("ChatGPT's response was interrupted. Please try again.");
    return completed;
  } catch (error) {
    // SDK errors can carry request metadata. Return only a user-facing reason.
    if (error instanceof OpenAI.APIError)
      throw new Error(chatGPTError(error.code));
    throw error;
  }
}

export function responseText(response: Pick<Response, "output">) {
  return response.output
    .flatMap((item) =>
      item.type === "message"
        ? item.content.flatMap((content) =>
            content.type === "output_text"
              ? [content.text]
              : content.type === "refusal"
                ? [content.refusal]
                : [],
          )
        : [],
    )
    .join("\n");
}
