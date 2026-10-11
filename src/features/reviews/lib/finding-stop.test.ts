// @vitest-environment node
import { expect, test } from "vitest";
import { FindingStopped, findingStopReason } from "./finding-stop";

test("infrastructure abort reasons remain distinct from user cancellation", () => {
  const abort = new AbortController();
  abort.abort(new Error("Convex connection failed"));
  expect(findingStopReason(new Error("Runner stopped"), abort.signal)).toBe(
    "infrastructure",
  );
});

test.each(["cancelled", "time-limit", "cost-limit", "infrastructure"] as const)(
  "typed %s abort retains its reason",
  (reason) => {
    const abort = new AbortController();
    abort.abort(new FindingStopped(reason, "Stopped"));
    expect(findingStopReason(new Error("Runner stopped"), abort.signal)).toBe(
      reason,
    );
  },
);

test("default AbortController cancellation still means cancelled", () => {
  const abort = new AbortController();
  abort.abort();
  expect(findingStopReason(new Error("Runner stopped"), abort.signal)).toBe(
    "cancelled",
  );
});
