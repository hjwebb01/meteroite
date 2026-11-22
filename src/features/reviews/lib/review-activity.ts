import type { Infer } from "convex/values";
import type { Doc } from "../../../../convex/_generated/dataModel";
import type { reviewActivity } from "../../../../convex/lib/review_stage";
import { reviewStageName, type ReviewStageName } from "./review-stage";

export type ActivityEntry = Infer<typeof reviewActivity>;

type ActivityRun = Pick<
  Doc<"reviews">,
  "status" | "stage" | "parts" | "partsDone"
>;

export type StageRow = {
  key: string;
  label: string;
  state: "queued" | "pending" | "done" | "active" | "failed" | "cancelled";
};

export type ToolRow = {
  key: string;
  tool: string;
  text: string;
  calls: number[];
  entries: ActivityEntry[];
  target?: { path: string; start?: number; end?: number };
  at?: number;
};

export type ActivitySection = { stage: StageRow; tools: ToolRow[] };

const STAGES: ReviewStageName[] = ["load", "investigate", "finish"];

function stageState(
  status: ActivityRun["status"],
  index: number,
  current: number,
): StageRow["state"] {
  if (index > current) return "pending";
  if (index < current || status === "completed") return "done";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  return "active";
}

function contiguousRuns(activity: ActivityEntry[]) {
  const runs: number[][] = [];
  activity.forEach((entry, index) => {
    const run = runs.at(-1);
    const first = run && activity[run[0]];
    if (run && first?.stage === entry.stage && first.tool === entry.tool)
      run.push(index);
    else runs.push([index]);
  });
  return runs;
}

function toolRow(indexes: number[], activity: ActivityEntry[]): ToolRow {
  const entries = indexes.map((i) => activity[i]);
  const first = entries[0];
  return {
    key: `${first.stage}-${indexes[0]}`,
    tool: first.tool,
    text: groupText(entries),
    calls: indexes.map((i) => i + 1),
    entries,
    target:
      entries.length === 1 && first.path
        ? { path: first.path, start: first.start, end: first.end }
        : undefined,
    at: first.at,
  };
}

export function buildActivityRows(
  run: ActivityRun,
  activity: ActivityEntry[],
): ActivitySection[] {
  const completed = run.status === "completed";
  if (!run.stage && !completed)
    return run.status === "queued"
      ? [
          {
            stage: { key: "queued", label: "Queued", state: "queued" },
            tools: [],
          },
        ]
      : [];
  const current = completed
    ? STAGES.length - 1
    : STAGES.findIndex((stage) => stage === run.stage);
  const stopped = run.status === "failed" || run.status === "cancelled";
  const runs = contiguousRuns(activity).map((indexes) => ({
    stage: activity[indexes[0]].stage,
    row: toolRow(indexes, activity),
  }));
  return STAGES.flatMap((stage, index) => {
    if (index > current && stopped) return [];
    return [
      {
        stage: {
          key: stage,
          label: reviewStageName({ ...run, stage }) ?? stage,
          state: stageState(run.status, index, current),
        },
        tools: runs
          .filter((entry) => entry.stage === stage)
          .map((entry) => entry.row),
      },
    ];
  });
}

const PLURAL: Record<string, (n: number, where: string) => string> = {
  readFile: (n, where) =>
    n === 1
      ? `Reading one file in several parts${where}`
      : `Reading ${n} files${where}`,
  searchText: (n, where) => `Searching ${n} times${where}`,
  listFiles: (n, where) => `Listing ${n} folders${where}`,
  getChangedLines: (n, where) => `Checking changed lines in ${n} files${where}`,
};

function sharedFolder(paths: string[][]) {
  const shared: string[] = [];
  for (let i = 0; ; i++) {
    const part = paths[0][i];
    if (
      part === undefined ||
      paths.some((p) => p.length - 1 <= i || p[i] !== part)
    )
      return shared;
    shared.push(part);
  }
}

function groupText(entries: ActivityEntry[]) {
  if (entries.length === 1) return entries[0].text;
  const paths = entries.flatMap((e) => (e.path ? [e.path.split("/")] : []));
  const shared = paths.length === entries.length ? sharedFolder(paths) : [];
  const where = shared.length ? ` in ${shared.join("/")}/` : "";
  const files = new Set(entries.map((e) => e.path)).size;
  const n = entries[0].tool === "readFile" ? files : entries.length;
  return (PLURAL[entries[0].tool] ?? ((c) => `${c} calls`))(n, where);
}
