import { z } from "zod";

import { AUTOCOMPLETE_MODEL_IDS } from "./autocomplete-models";
import { CURSOR_MARKER } from "./prompt-format";
import { MAX_HUNKS } from "./edit-history";
import { RELATED_CONTEXT_BUDGET_CHARS } from "./related-context";

// Server-side caps a little above the client budgets so oversized payloads never reach the model.
const MAX_PATH_CHARS = 1_000;
const MAX_CODE_CHARS = 20_000;
const MAX_EDIT_SIDE_CHARS = 1_000;

export const relatedFilesSchema = z
  .array(
    z.object({
      path: z.string().max(MAX_PATH_CHARS),
      signatures: z.string().max(RELATED_CONTEXT_BUDGET_CHARS),
    }),
  )
  .max(50);

export const suggestionRequestSchema = z.object({
  model: z.enum(AUTOCOMPLETE_MODEL_IDS).optional(),
  fileName: z.string().max(MAX_PATH_CHARS),
  code: z
    .string()
    .min(1)
    .max(MAX_CODE_CHARS)
    .refine((code) => code.includes(CURSOR_MARKER), {
      message: "Code must contain the cursor marker",
    }),
  relatedFiles: relatedFilesSchema.optional(),
  recentEdits: z
    .array(
      z.object({
        before: z.string().max(MAX_EDIT_SIDE_CHARS),
        after: z.string().max(MAX_EDIT_SIDE_CHARS),
      }),
    )
    .max(MAX_HUNKS)
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
