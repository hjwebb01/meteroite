import ky from "ky";
import { toast } from "sonner";
import {
  suggestionResponseSchema,
  type SuggestionRequest,
  type SuggestionResponse,
} from "./suggestion-schema";
import { useAutocompleteModelStore } from "../../store/use-autocomplete-model-store";

const ERROR_TOAST_COOLDOWN_MS = 60_000;
let lastErrorToastAt = -Infinity;

export const fetcher = async (
  payload: SuggestionRequest,
  signal: AbortSignal,
): Promise<SuggestionResponse["edits"] | null> => {
  try {
    const response = await ky
      .post("/api/suggestion", {
        json: { ...payload, model: useAutocompleteModelStore.getState().model },
        signal,
        timeout: 10_000,
        retry: 0,
      })
      .json();

    return suggestionResponseSchema.parse(response).edits;
  } catch {
    if (signal.aborted) return null;
    const now = Date.now();
    if (now - lastErrorToastAt >= ERROR_TOAST_COOLDOWN_MS) {
      lastErrorToastAt = now;
      toast.error("Failed to fetch suggestion");
    }
    return null;
  }
};
