import { describe, expect, it } from "vitest";
import { computeCoverage, evidenceTrail } from "./review-coverage";
import type { ActivityEntry } from "./review-activity";

const files = [
  {
    filename: "src/cart.js",
    changedLineRanges: {
      RIGHT: [
        { start: 1, end: 2 },
        { start: 6, end: 10 },
      ],
    },
  },
  {
    filename: "src/discount.js",
    changedLineRanges: { RIGHT: [{ start: 1, end: 13 }] },
  },
  {
    filename: "test/cart.test.js",
    changedLineRanges: { RIGHT: [{ start: 17, end: 20 }] },
  },
];
const read = (path: string, start: number, end: number): ActivityEntry => ({
  stage: "investigate",
  tool: "readFile",
  text: `Reading ${path}`,
  path,
  start,
  end,
});

describe("computeCoverage", () => {
  const activity = [
    {
      stage: "investigate",
      tool: "listFiles",
      text: "Listing src",
    } as ActivityEntry,
    read("src/cart.js", 1, 11),
    read("src/discount.js", 8, 12),
    read("src/discount.js", 10, 13),
  ];

  it("counts opened added lines once and lists files never opened", () => {
    const c = computeCoverage(files, activity);
    expect([c.read, c.total]).toEqual([7 + 6, 24]);
    expect(c.unread).toEqual(["test/cart.test.js"]);
    expect(c.files.map((f) => f.opened)).toEqual([true, true, false]);
  });

  it("links a cited line to the reads that covered it", () => {
    expect(
      evidenceTrail({ path: "src/cart.js", line: 9 }, files, activity),
    ).toEqual({ calls: [2], inDiff: true });
    expect(
      evidenceTrail({ path: "src/discount.js", line: 10 }, files, activity)
        .calls,
    ).toEqual([3, 4]);
    expect(
      evidenceTrail({ path: "test/cart.test.js", line: 18 }, files, activity)
        .calls,
    ).toEqual([]);
  });
});
