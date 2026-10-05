import { describe, expect, test } from "vitest";
import {
  CODING_MODELS,
  DEFAULT_CODING_MODEL_ID,
  assertCodingModelId,
  getCodingModel,
  isCodingModelId,
  resolveCodingModelId,
} from "./coding_models";

describe("coding models", () => {
  test("the default model is selectable and listed once per id", () => {
    const ids = CODING_MODELS.map((model) => model.id);
    expect(ids).toContain(DEFAULT_CODING_MODEL_ID);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("falls back to the default for missing or unknown models", () => {
    expect(resolveCodingModelId(undefined)).toBe(DEFAULT_CODING_MODEL_ID);
    expect(resolveCodingModelId(null)).toBe(DEFAULT_CODING_MODEL_ID);
    expect(resolveCodingModelId("retired/model")).toBe(DEFAULT_CODING_MODEL_ID);
    expect(resolveCodingModelId("z-ai/glm-5.3-flash")).toBe(
      "z-ai/glm-5.3-flash",
    );
    expect(getCodingModel("retired/model").id).toBe(DEFAULT_CODING_MODEL_ID);
  });

  test("assertCodingModelId only rejects defined, unsupported ids", () => {
    expect(assertCodingModelId(undefined)).toBeUndefined();
    expect(assertCodingModelId("deepseek/deepseek-v4.1-flash")).toBe("deepseek/deepseek-v4.1-flash");
    expect(() => assertCodingModelId("openai/not-a-model")).toThrow(
      /Unsupported model/,
    );
    expect(isCodingModelId("")).toBe(false);
  });
});
