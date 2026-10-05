import { z } from "zod";

import { AUTOCOMPLETE_MODEL_IDS } from "./autocomplete-models";
import { CURSOR_MARKER } from "./prompt-format";

export const suggestionRequestSchema = z.object({
  model: z.enum(AUTOCOMPLETE_MODEL_IDS).optional(),
  fileName: z.string(),
  code: z
    .string()
    .min(1)
    .refine((code) => code.includes(CURSOR_MARKER), {
      message: "Code must contain the cursor marker",
    }),
  relatedFiles: z
    .array(z.object({ path: z.string(), signatures: z.string() }))
    .optional(),
  recentEdits: z
    .array(z.object({ before: z.string(), after: z.string() }))
    .optional(),
});

export const suggestionResponseSchema = z.object({
  edits: z.array(
    z.object({
      anchor: z
        .string()
        .describe(
          "Exact unique text from the excerpt, excluding the cursor marker; empty for insertion at cursor.",
        ),
      replacement: z.string(),
    }),
  ),
});

export type SuggestionRequest = z.infer<typeof suggestionRequestSchema>;
export type SuggestionResponse = z.infer<typeof suggestionResponseSchema>;
