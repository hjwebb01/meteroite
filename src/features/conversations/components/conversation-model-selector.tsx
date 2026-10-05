import { useState } from "react";
import { CheckIcon, ChevronDownIcon } from "lucide-react";

import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import { PromptInputButton } from "@/components/ai-elements/prompt-input";
import {
  CODING_MODELS,
  getCodingModel,
  type CodingModel,
  type CodingModelId,
} from "../../../../convex/lib/coding-models";

const PROVIDER_NAMES: Record<CodingModel["provider"], string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  deepseek: "DeepSeek",
  moonshotai: "Moonshot AI",
  zai: "Z.ai",
};

const MODELS_BY_PROVIDER = Object.entries(
  Object.groupBy(CODING_MODELS, (model) => model.provider),
);

interface ConversationModelSelectorProps {
  value: CodingModelId;
  onValueChange: (model: CodingModelId) => void;
}

export const ConversationModelSelector = ({
  value,
  onValueChange,
}: ConversationModelSelectorProps) => {
  const [open, setOpen] = useState(false);
  const selected = getCodingModel(value);

  return (
    <ModelSelector open={open} onOpenChange={setOpen}>
      <ModelSelectorTrigger asChild>
        <PromptInputButton
          size="sm"
          className="min-w-0 max-w-full"
          aria-label={`Model: ${selected.name}`}
        >
          <ModelSelectorLogo provider={selected.provider} />
          <span className="truncate">{selected.name}</span>
          <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
        </PromptInputButton>
      </ModelSelectorTrigger>
      <ModelSelectorContent title="Select a model">
        <ModelSelectorInput placeholder="Search models..." />
        <ModelSelectorList>
          <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
          {MODELS_BY_PROVIDER.map(([provider, models]) => (
            <ModelSelectorGroup
              key={provider}
              heading={PROVIDER_NAMES[provider as CodingModel["provider"]]}
            >
              {models?.map((model) => (
                <ModelSelectorItem
                  key={model.id}
                  value={model.id}
                  keywords={[model.name, model.provider]}
                  onSelect={() => {
                    onValueChange(model.id);
                    setOpen(false);
                  }}
                >
                  <ModelSelectorLogo provider={model.provider} />
                  <ModelSelectorName>{model.name}</ModelSelectorName>
                  {model.id === value && (
                    <CheckIcon className="ml-auto size-3.5" />
                  )}
                </ModelSelectorItem>
              ))}
            </ModelSelectorGroup>
          ))}
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  );
};
