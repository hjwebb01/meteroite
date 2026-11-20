import { describe, expect, test } from "vitest";
import { formatElapsed, reviewStageLabel } from "./review-stage";

describe("reviewStageLabel", () => {
  test("queued runs show Queued before any stage is written", () => {
    expect(reviewStageLabel({ status: "queued" })).toBe("Queued");
  });

  test("names each stage and counts parts", () => {
    expect(reviewStageLabel({ status: "running", stage: "load" })).toBe(
      "Loading pull request",
    );
    expect(reviewStageLabel({ status: "running", stage: "investigate" })).toBe(
      "Investigating changes",
    );
    expect(
      reviewStageLabel({
        status: "running",
        stage: "investigate",
        parts: 3,
        partsDone: 1,
      }),
    ).toBe("Investigating in 3 parts, 1 done");
    expect(reviewStageLabel({ status: "running", stage: "finish" })).toBe(
      "Finishing review",
    );
  });

  test("keeps the stage where a failed or cancelled run stopped", () => {
    expect(reviewStageLabel({ status: "failed", stage: "investigate" })).toBe(
      "Investigating changes · failed",
    );
    expect(reviewStageLabel({ status: "cancelled", stage: "load" })).toBe(
      "Loading pull request · cancelled",
    );
  });

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
