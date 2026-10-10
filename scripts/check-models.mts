// Checks every hard-coded OpenRouter model ID against the live catalog, along
// with the capabilities its callers rely on. Run after changing any model list.
import { REVIEW_MODELS } from "../convex/lib/review_models.ts";
import { CODING_MODELS } from "../convex/lib/coding_models.ts";

type CatalogModel = { id: string; supported_parameters?: string[] };

const requirements: { id: string; usage: string; needs: string[] }[] = [
  ...CODING_MODELS.map(({ id }) => ({
    id,
    usage: "coding agent",
    needs: ["tools", "reasoning"],
  })),
  ...REVIEW_MODELS.map(({ id }) => ({
    id,
    usage: "PR review",
    needs: ["tools", "structured_outputs"],
  })),
];

const response = await fetch("https://openrouter.ai/api/v1/models");
if (!response.ok) {
  throw new Error(`OpenRouter catalog request failed: ${response.status}`);
}
const { data } = (await response.json()) as { data: CatalogModel[] };
const catalog = new Map(data.map((model) => [model.id, model]));

const failures = requirements.flatMap(({ id, usage, needs }) => {
  const model = catalog.get(id);
  if (!model) return [`${id} (${usage}): not in the OpenRouter catalog`];
  const missing = needs.filter(
    (param) => !model.supported_parameters?.includes(param),
  );
  return missing.length > 0
    ? [`${id} (${usage}): missing ${missing.join(", ")}`]
    : [];
});

if (failures.length > 0) {
  console.error("Model check failed:");
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`All ${requirements.length} model entries are valid.`);
