import { ChevronDownIcon } from "lucide-react";

import { ModelSelectorLogo } from "@/components/ai-elements/model-selector";
import { ModelPicker } from "@/components/model-picker";
import { Button } from "@/components/ui/button";
import { AUTOCOMPLETE_MODELS } from "../extensions/suggestion/autocomplete-models";
import { useAutocompleteModelStore } from "../store/use-autocomplete-model-store";

export const AutocompleteModelSelector = () => {
  const model = useAutocompleteModelStore((state) => state.model);
  const setModel = useAutocompleteModelStore((state) => state.setModel);
  const selected =
    AUTOCOMPLETE_MODELS.find((entry) => entry.id === model) ??
    AUTOCOMPLETE_MODELS[0];

  return (
    <ModelPicker
      models={AUTOCOMPLETE_MODELS}
      value={selected.id}
      onValueChange={setModel}
      title="Select an autocomplete model"
      trigger={
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1.5 px-2 text-xs text-muted-foreground"
          aria-label={`Autocomplete model: ${selected.name}`}
          title="Autocomplete model"
        >
          <ModelSelectorLogo provider={selected.provider} />
          <span className="truncate">{selected.name}</span>
          <ChevronDownIcon className="size-3 shrink-0" />
        </Button>
      }
    />
  );
};
