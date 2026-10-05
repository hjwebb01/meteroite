import { useState, type ReactNode } from "react";
import { CheckIcon } from "lucide-react";

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

const PROVIDER_NAMES: Record<string, string> = {
  alibaba: "Alibaba",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  zai: "Z.ai",
};

interface PickerModel<Id extends string> {
  id: Id;
  name: string;
  provider: string;
}

interface ModelPickerProps<Id extends string> {
  models: readonly PickerModel<Id>[];
  value: Id;
  onValueChange: (model: Id) => void;
  /** Rendered as the trigger via `asChild`, so it must forward refs and props. */
  trigger: ReactNode;
  title?: string;
}

export const ModelPicker = <Id extends string>({
  models,
  value,
  onValueChange,
  trigger,
  title = "Select a model",
}: ModelPickerProps<Id>) => {
  const [open, setOpen] = useState(false);
  const modelsByProvider = Object.entries(
    Object.groupBy(models, (model) => model.provider),
  );

  return (
    <ModelSelector open={open} onOpenChange={setOpen}>
      <ModelSelectorTrigger asChild>{trigger}</ModelSelectorTrigger>
      <ModelSelectorContent title={title}>
        <ModelSelectorInput placeholder="Search models..." />
        <ModelSelectorList>
          <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
          {modelsByProvider.map(([provider, providerModels]) => (
            <ModelSelectorGroup
              key={provider}
              heading={PROVIDER_NAMES[provider] ?? provider}
            >
              {providerModels?.map((model) => (
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
