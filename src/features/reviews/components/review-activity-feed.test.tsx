import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildActivityRows, type ActivityEntry } from "../lib/review-activity";
import { ReviewActivityFeed } from "./review-activity-feed";

const run = { status: "running" as const, stage: "investigate" as const };
const activity: ActivityEntry[] = [
  { stage: "load", tool: "listFiles", text: "src", at: 1 },
  { stage: "load", tool: "readFile", text: "a.ts", at: 2 },
  { stage: "investigate", tool: "readFile", text: "b.ts", at: 3 },
];

describe("ReviewActivityFeed", () => {
  it("groups tool rows under their stage", () => {
    const sections = buildActivityRows(run, activity);
    expect(sections.map((s) => [s.stage.key, s.tools.length])).toEqual([
      ["load", 2],
      ["investigate", 1],
      ["finish", 0],
    ]);
  });

  it("keeps activity visible while live and folds finished stages afterward", () => {
    const html = renderToStaticMarkup(
      <ReviewActivityFeed
        sections={buildActivityRows(run, activity)}
        live
        startedAt={0}
      />,
    );
    expect(html).toContain("b.ts");
    expect(html.indexOf("a.ts")).toBeLessThan(html.indexOf("b.ts"));
    expect(html).not.toContain("2 steps");
    expect(
      renderToStaticMarkup(
        <ReviewActivityFeed
          sections={buildActivityRows(run, activity)}
          live={false}
        />,
      ),
    ).toContain("2 steps");
  });

  it("counts grouped calls and retains their individual targets", () => {
    const sections = buildActivityRows(run, [
      {
        stage: "investigate",
        tool: "readFile",
        text: "Reading a",
        path: "a.ts",
        at: 1,
      },
      {
        stage: "investigate",
        tool: "readFile",
        text: "Reading b",
        path: "b.ts",
        at: 2,
      },
    ]);
    const html = renderToStaticMarkup(
      <ReviewActivityFeed
        sections={sections}
        live
        collapsed
        onOpen={() => {}}
      />,
    );
    expect(html).toContain("Reading a");
    expect(html).toContain("Reading b");
  });
});
