import { z } from "zod";
export type FindingPrice = {
  inputMicrosPerToken: number;
  outputMicrosPerToken: number;
  quotedAt: number;
};
export async function quoteFindingModel(model: string): Promise<FindingPrice> {
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok)
    throw new Error(
      "Model pricing is unavailable. Try again when pricing can be verified.",
    );
  const schema = z.object({
    data: z.array(
      z.object({
        id: z.string(),
        pricing: z.object({
          prompt: z.string(),
          completion: z.string(),
          request: z.string().optional(),
        }),
      }),
    ),
  });
  const catalog = schema.parse(await response.json());
  const entry = catalog.data.find((x) => x.id === model);
  if (!entry)
    throw new Error(
      "This model has no verified price for a capped investigation.",
    );
  if (entry.pricing.request && Number(entry.pricing.request) !== 0)
    throw new Error(
      "Models with additional request fees are unavailable for capped investigations.",
    );
  const input = Number(entry.pricing.prompt),
    output = Number(entry.pricing.completion);
  if (![input, output].every((x) => Number.isFinite(x) && x >= 0 && x <= 0.01))
    throw new Error("This model has no usable price quote.");
  return {
    inputMicrosPerToken: Math.ceil(input * 2_000_000),
    outputMicrosPerToken: Math.ceil(output * 2_000_000),
    quotedAt: Date.now(),
  };
}
const PRICE_QUOTE_TTL_MS = 15 * 60_000;
const isPriceQuoteCurrent = (price: FindingPrice) =>
  Date.now() - price.quotedAt <= PRICE_QUOTE_TTL_MS;

// Queued or retried work can outlive the quote taken when it was requested.
export async function currentFindingPrice(
  model: string,
  saved?: FindingPrice,
): Promise<FindingPrice> {
  return saved && isPriceQuoteCurrent(saved) ? saved : quoteFindingModel(model);
}

export function maximumCallCost(
  price: FindingPrice,
  system: string,
  messages: unknown,
  maxOutputTokens: number,
) {
  if (!isPriceQuoteCurrent(price))
    throw new Error("Model price quote expired. Start a new investigation.");
  const input =
    Buffer.byteLength(system) +
    Buffer.byteLength(JSON.stringify(messages)) +
    8000;
  if (input > 120_000)
    throw new Error("Investigation model context limit reached");
  return (
    input * price.inputMicrosPerToken +
    maxOutputTokens * price.outputMicrosPerToken
  );
}
