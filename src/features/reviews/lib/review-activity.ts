import { reviewStageName, type ReviewStageName } from "./review-stage";

export type ActivityEntry = {
  stage: ReviewStageName;
  tool: string;
  text: string;
  at?: number;
  path?: string;
  start?: number;
  end?: number;
};

export type ActivityRun = {
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  stage?: ReviewStageName;
  parts?: number;
  partsDone?: number;
  activity?: ActivityEntry[];
};

export type ActivityRow =
  | {
      kind: "stage";
      key: string;
      label: string;
      state: "queued" | "pending" | "done" | "active" | "failed" | "cancelled";
    }
  | {
      kind: "tool";
      key: string;
      tool: string;
      text: string;
      state: "done" | "active" | "stopped";
      calls: number[];
      target?: { path: string; start?: number; end?: number };
      at?: number;
    };

const STAGES: ReviewStageName[] = ["load", "investigate", "finish"];

export function buildActivityRows(run: ActivityRun): ActivityRow[] {
  const completed = run.status === "completed";
  if (!run.stage && !completed)
    return run.status === "queued"
      ? [{ kind: "stage", key: "queued", label: "Queued", state: "queued" }]
      : [];
  const current = completed
    ? STAGES.length - 1
    : STAGES.indexOf(run.stage as ReviewStageName);
  const activity = run.activity ?? [];
  const newest = activity.length - 1;
  const stopped = run.status === "failed" || run.status === "cancelled";
  const rows: ActivityRow[] = [];
  STAGES.forEach((stage, index) => {
    if (index > current && stopped) return;
    const isCurrent = index === current && !completed;
    rows.push({
      kind: "stage",
      key: stage,
      label: reviewStageName({ ...run, stage }) ?? stage,
      state:
        index > current
          ? "pending"
          : !isCurrent
            ? "done"
            : run.status === "failed"
              ? "failed"
              : run.status === "cancelled"
                ? "cancelled"
                : "active",
    });
    let group: number[] = [];
    const flush = () => {
      if (!group.length) return;
      const entries = group.map((i) => activity[i]);
      const first = entries[0];
      const last = group.at(-1) as number;
      const isNewest = last === newest && first.stage === run.stage;
      rows.push({
        kind: "tool",
        key: `${stage}-${group[0]}`,
        tool: first.tool,
        text: groupText(entries),
        calls: group.map((i) => i + 1),
        target:
          group.length === 1 && first.path
            ? { path: first.path, start: first.start, end: first.end }
            : undefined,
        at: first.at,
        state: !isNewest
          ? "done"
          : stopped
            ? "stopped"
            : run.status === "running"
              ? "active"
              : "done",
      });
      group = [];
    };
    activity.forEach((entry, i) => {
      if (entry.stage !== stage) return flush();
      if (group.length && activity[group[0]].tool !== entry.tool) flush();
      group.push(i);
    });
    flush();
  });
  return rows;
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

function groupText(entries: ActivityEntry[]) {
  if (entries.length === 1) return entries[0].text;
  const paths = entries.flatMap((e) => (e.path ? [e.path.split("/")] : []));
  const shared: string[] = [];
  for (let i = 0; paths.length === entries.length; i++) {
    const part = paths[0][i];
    if (
      part === undefined ||
      paths.some((p) => p.length - 1 <= i || p[i] !== part)
    )
      break;
    shared.push(part);
  }
  const where = shared.length ? ` in ${shared.join("/")}/` : "";
  const files = new Set(entries.map((e) => e.path)).size;
  const n = entries[0].tool === "readFile" ? files : entries.length;
  return (PLURAL[entries[0].tool] ?? ((c) => `${c} calls`))(n, where);
}
