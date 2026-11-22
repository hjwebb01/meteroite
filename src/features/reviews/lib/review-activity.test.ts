import { expect, test } from "vitest";
import { buildActivityRows, type ActivityEntry } from "./review-activity";

const calls: ActivityEntry[] = [
  {
    stage: "investigate",
    tool: "readFile",
    text: "Reading src/cart.js",
    at: 1,
  },
  {
    stage: "investigate",
    tool: "searchText",
    text: "Searching for total",
    at: 2,
  },
  {
    stage: "investigate",
    tool: "readFile",
    text: "Reading src/totals.ts",
    at: 3,
  },
];

test("a queued run shows one queued section", () => {
  expect(
    buildActivityRows(
      {
        status: "queued",
        stage: undefined,
        parts: undefined,
        partsDone: undefined,
      },
      [],
    ),
  ).toEqual([
    {
      stage: { key: "queued", label: "Queued", state: "queued" },
      tools: [],
    },
  ]);
});

test("a running investigation lists recorded calls without claiming they are active", () => {
  const sections = buildActivityRows(
    { status: "running", stage: "investigate", parts: 3, partsDone: 1 },
    calls,
  );
  expect(sections.map((section) => section.stage.key)).toEqual([
    "load",
    "investigate",
    "finish",
  ]);
  expect(sections[0].stage.state).toBe("done");
  expect(sections[1].stage).toMatchObject({
    label: "Investigating in 3 parts, 1 done",
    state: "active",
  });
  expect(sections[2].stage.state).toBe("pending");
  expect(sections[1].tools.map((tool) => tool.calls)).toEqual([[1], [2], [3]]);
});

test("a finish stage marks the investigation done and the finish line active", () => {
  const sections = buildActivityRows(
    {
      status: "running",
      stage: "finish",
      parts: undefined,
      partsDone: undefined,
    },
    calls,
  );
  expect(sections.at(-1)).toMatchObject({
    stage: { key: "finish", state: "active" },
  });
  expect(sections.flatMap((section) => section.tools)).toHaveLength(3);
});

test("a failed run keeps its stage marked without guessing call status", () => {
  const sections = buildActivityRows(
    {
      status: "failed",
      stage: "investigate",
      parts: undefined,
      partsDone: undefined,
    },
    calls,
  );
  expect(
    sections.find((section) => section.stage.key === "investigate")?.stage
      .state,
  ).toBe("failed");
});

test("a completed run keeps every stage and call, all done", () => {
  const sections = buildActivityRows(
    {
      status: "completed",
      stage: "finish",
      parts: undefined,
      partsDone: undefined,
    },
    calls,
  );
  expect(sections).toHaveLength(3);
  expect(sections.every((section) => section.stage.state === "done")).toBe(
    true,
  );
  expect(sections.flatMap((section) => section.tools)).toHaveLength(3);
});
