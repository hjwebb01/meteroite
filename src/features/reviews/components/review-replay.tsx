"use client";

import { useEffect, useState } from "react";
import { buildActivityRows, type ActivityEntry } from "../lib/review-activity";
import { ReviewActivityFeed } from "./review-activity-feed";
import { ReviewHeadline } from "./review-headline";
import { reviewStageName } from "../lib/review-stage";

const FILES = [
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
const read = (
  at: number,
  path: string,
  start: number,
  end: number,
): [number, ActivityEntry] => [
  at,
  {
    stage: "investigate",
    tool: "readFile",
    text: `Reading ${path}`,
    path,
    start,
    end,
  },
];
const LOG: [number, ActivityEntry][] = [
  [
    4_000,
    { stage: "load", tool: "getChangedLines", text: "Loading changed files" },
  ],
  [
    12_000,
    {
      stage: "investigate",
      tool: "listFiles",
      text: "Listing src/",
      path: "src",
    },
  ],
  read(19_000, "src/cart.js", 1, 11),
  read(27_000, "src/discount.js", 1, 13),
  [
    35_000,
    {
      stage: "investigate",
      tool: "searchText",
      text: "Searching for applyDiscount",
    },
  ],
  read(48_000, "src/cart.js", 6, 10),
  [70_000, { stage: "finish", tool: "listFiles", text: "Checking findings" }],
];
const TOTAL_MS = 80_000;

export function ReviewReplay({ speed }: { speed: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(
      () => setElapsed(Math.min(TOTAL_MS, (Date.now() - start) * speed)),
      250,
    );
    return () => clearInterval(id);
  }, [speed]);
  const t0 = 1_700_000_000_000;
  const activity = LOG.filter(([at]) => at <= elapsed).map(([at, e]) => ({
    ...e,
    at: t0 + at,
  }));
  const last = activity.at(-1);
  const stage = last?.stage ?? "load";
  const done = elapsed >= TOTAL_MS;
  const run = {
    status: done ? ("completed" as const) : ("running" as const),
    stage,
  };
  return (
    <main className="mx-auto max-w-4xl p-6">
      <section
        className="review-reading-plane p-6 sm:p-9"
        aria-label="Analysis activity"
      >
        <p className="text-xs text-review-link">
          Analysis activity · replay of a fixture-shaped run
        </p>
        <h2 className="mt-5 text-xl leading-snug">
          {reviewStageName({ stage }) ?? "Queued"}
        </h2>
        <ReviewHeadline
          stage={reviewStageName({ stage }) ?? "Queued"}
          elapsedMs={elapsed}
          files={FILES}
          activity={activity}
        />
        <ReviewActivityFeed
          sections={buildActivityRows(run, activity)}
          live={!done}
          startedAt={t0}
        />
      </section>
    </main>
  );
}
