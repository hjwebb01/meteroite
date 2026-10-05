import { ChevronDownIcon } from "lucide-react";

import { ModelSelectorLogo } from "@/components/ai-elements/model-selector";
import { PromptInputButton } from "@/components/ai-elements/prompt-input";
import { ModelPicker } from "@/components/model-picker";
import {
  CODING_MODELS,
  getCodingModel,
  type CodingModelId,
} from "../../../../convex/lib/coding_models";

interface ConversationModelSelectorProps {
  value: CodingModelId;
  onValueChange: (model: CodingModelId) => void;
}

export const ConversationModelSelector = ({
  value,
  onValueChange,
}: ConversationModelSelectorProps) => {
  const selected = getCodingModel(value);

  return (
    <ModelPicker
      models={CODING_MODELS}
      value={value}
      onValueChange={onValueChange}
      trigger={
        <PromptInputButton
          size="sm"
          className="min-w-0 max-w-full"
          aria-label={`Model: ${selected.name}`}
        >
          <ModelSelectorLogo provider={selected.provider} />
          <span className="truncate">{selected.name}</span>
          <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
        </PromptInputButton>
      }
    />
  );
};
