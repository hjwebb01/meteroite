import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_AUTOCOMPLETE_MODEL_ID,
  resolveAutocompleteModelId,
  type AutocompleteModelId,
} from "../extensions/suggestion/autocomplete-models";

interface AutocompleteModelStore {
  model: AutocompleteModelId;
  setModel: (model: AutocompleteModelId) => void;
}

export const useAutocompleteModelStore = create<AutocompleteModelStore>()(
  persist(
    (set) => ({
      model: DEFAULT_AUTOCOMPLETE_MODEL_ID,
      setModel: (model) => set({ model }),
    }),
    {
      name: "autocomplete-model",
      merge: (persisted, current) => ({
        ...current,
        model: resolveAutocompleteModelId(
          (persisted as Partial<AutocompleteModelStore> | undefined)?.model,
        ),
      }),
    },
  ),
);
