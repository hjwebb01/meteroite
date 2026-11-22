import { describe, expect, test } from "vitest";
import { formatElapsed, reviewStageLabel } from "./review-stage";

describe("reviewStageLabel", () => {
  test("completed runs and failures before any stage show no stage line", () => {
    expect(
      reviewStageLabel({ status: "completed", stage: "finish" }),
    ).toBeNull();
    expect(reviewStageLabel({ status: "failed" })).toBeNull();
  });

  test("a done count never exceeds the part total", () => {
    expect(
      reviewStageLabel({
        status: "running",
        stage: "investigate",
        parts: 2,
        partsDone: 3,
      }),
    ).toBe("Investigating in 2 parts, 2 done");
  });
});

describe("formatElapsed", () => {
  test("shows seconds, then minutes and seconds", () => {
    expect(formatElapsed(42_900)).toBe("42 s");
    expect(formatElapsed(134_000)).toBe("2 min 14 s");
    expect(formatElapsed(-5)).toBe("0 s");
  });
});
