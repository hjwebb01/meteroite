import { expect, test } from "vitest";
import { buildActivityRows } from "./review-activity";

const calls = [
  {
    stage: "investigate" as const,
    tool: "readFile",
    text: "Reading src/cart.js",
  },
  {
    stage: "investigate" as const,
    tool: "searchText",
    text: "Searching for total",
  },
  {
    stage: "investigate" as const,
    tool: "readFile",
    text: "Reading src/totals.ts",
  },
];

test("a queued run shows one queued row", () => {
  expect(buildActivityRows({ status: "queued" })).toEqual([
    { kind: "stage", key: "queued", label: "Queued", state: "queued" },
  ]);
});

test("a running investigation lists each call under its stage, newest active", () => {
  const rows = buildActivityRows({
    status: "running",
    stage: "investigate",
    parts: 3,
    partsDone: 1,
    activity: calls,
  });
  expect(rows.map((row) => [row.key, row.kind])).toEqual([
    ["load", "stage"],
    ["investigate", "stage"],
    ["investigate-0", "tool"],
    ["investigate-1", "tool"],
    ["investigate-2", "tool"],
    ["finish", "stage"],
  ]);
  expect(rows.at(-1)).toMatchObject({ state: "pending" });
  expect(rows[0]).toMatchObject({ state: "done" });
  expect(rows[1]).toMatchObject({
    label: "Investigating in 3 parts, 1 done",
    state: "active",
  });
  expect(rows.slice(2, 5).map((row) => row.state)).toEqual([
    "done",
    "done",
    "active",
  ]);
});

test("a finish stage marks the investigation done and the finish line active", () => {
  const rows = buildActivityRows({
    status: "running",
    stage: "finish",
    activity: calls,
  });
  expect(rows.at(-1)).toMatchObject({ key: "finish", state: "active" });
  expect(rows.filter((row) => row.kind === "tool")).toHaveLength(3);
  expect(
    rows.filter((row) => row.kind === "tool" && row.state === "active"),
  ).toHaveLength(0);
});

test("a failed run keeps its stage marked and stops the newest call", () => {
  const rows = buildActivityRows({
    status: "failed",
    stage: "investigate",
    activity: calls,
  });
  expect(rows.find((row) => row.key === "investigate")).toMatchObject({
    state: "failed",
  });
  expect(rows.at(-1)).toMatchObject({ key: "investigate-2", state: "stopped" });
});

test("a completed run keeps every stage and call, all done", () => {
  const rows = buildActivityRows({
    status: "completed",
    stage: "finish",
    activity: calls,
  });
  expect(rows).toHaveLength(6);
  expect(rows.every((row) => row.state === "done")).toBe(true);
});
