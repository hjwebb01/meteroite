import { describe, expect, it } from "vitest";
import { estimateText } from "./review-estimate";

describe("estimateText", () => {
  it("counts down to the median, then widens, then admits it is slow", () => {
    expect(estimateText(1_000)).toBe("about 60 s left, typically");
    expect(estimateText(100_000)).toBe("most reviews finish within 3 min");
    expect(estimateText(200_000)).toBe("taking longer than most reviews");
  });
});
