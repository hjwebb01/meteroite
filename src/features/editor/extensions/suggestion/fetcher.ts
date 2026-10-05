import ky from "ky";
import { z } from "zod";
import { toast } from "sonner";

const suggestionRequestSchema = z.object({
  fileName: z.string(),
  code: z.string(),
  currentLine: z.string(),
  previousLines: z.string().optional(),
  textBeforeCursor: z.string(),
  textAfterCursor: z.string(),
  nextLines: z.string().optional(),
  lineNumber: z.number(),
  relatedFiles: z
    .array(z.object({ path: z.string(), signatures: z.string() }))
    .optional(),
  recentEdits: z
    .array(
      z.object({
        startLine: z.number(),
        endLine: z.number(),
        before: z.string(),
        after: z.string(),
      }),
    )
    .optional(),
});

const suggestionResponseSchema = z.object({
  edits: z.array(z.object({ anchor: z.string(), replacement: z.string() })),
});

type SuggestionRequest = z.infer<typeof suggestionRequestSchema>;
type SuggestionResponse = z.infer<typeof suggestionResponseSchema>;

export const fetcher = async (
  payload: SuggestionRequest,
  signal: AbortSignal,
): Promise<SuggestionResponse["edits"] | null> => {
  try {
    const validatedPayload = suggestionRequestSchema.parse(payload);
    const response = await ky
      .post("/api/suggestion", {
        json: validatedPayload,
        signal,
        timeout: 10_000,
        retry: 0,
      })
      .json<SuggestionResponse>();

    const validatedResponse = suggestionResponseSchema.parse(response);
    return validatedResponse.edits;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return null;
    }
    toast.error("Failed to fetch suggestion");
    return null;
  }
};
