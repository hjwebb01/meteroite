import { describe, expect, it } from "vitest";
import { CODING_MODELS } from "../../../../convex/lib/coding_models";
import { createCodingModel, createTitleModel } from "./models";

describe("conversation models", () => {
  it("builds the selected coding model and falls back to the default", () => {
    expect(createCodingModel("anthropic/claude-opus-5.5").options.model).toBe(
      "anthropic/claude-opus-5.5",
    );
    expect(createCodingModel(undefined).options.model).toBe(
      "openai/gpt-5.4-mini",
    );
    expect(createCodingModel("retired/model").options.model).toBe(
      "openai/gpt-5.4-mini",
    );
  });

  it("keeps titles on the cheap model whatever the coding model is", () => {
    expect(createTitleModel().options.model).toBe("openai/gpt-5.4-mini");
  });

  it("only offers OpenRouter provider/model slugs", () => {
    for (const { id } of CODING_MODELS) {
      expect(id).toMatch(/^[a-z0-9-]+\/[a-z0-9.-]+$/);
    }
  });
});
