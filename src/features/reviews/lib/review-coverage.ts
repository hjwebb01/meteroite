import type { ActivityEntry } from "./review-activity";

type Range = { start: number; end: number };
export type CoverageFile = {
  filename: string;
  patch?: string;
  changedLineRanges?: { RIGHT: Range[] };
};

function openedWindows(activity: ActivityEntry[]) {
  const byPath = new Map<string, Range[]>();
  for (const e of activity)
    if (e.tool === "readFile" && e.path && e.start && e.end)
      byPath.set(e.path, [
        ...(byPath.get(e.path) ?? []),
        { start: e.start, end: e.end },
      ]);
  return byPath;
}

function overlap(range: Range, windows: Range[]) {
  const sorted = [...windows].sort((a, b) => a.start - b.start);
  let covered = 0;
  let from = range.start;
  for (const w of sorted) {
    const start = Math.max(w.start, from);
    const end = Math.min(w.end, range.end);
    if (end >= start) {
      covered += end - start + 1;
      from = end + 1;
    }
  }
  return covered;
}

export function computeCoverage(
  files: CoverageFile[],
  activity: ActivityEntry[],
) {
  const opened = openedWindows(activity);
  let read = 0;
  let total = 0;
  const unread: string[] = [];
  const opens: { filename: string; opened: boolean }[] = [];
  for (const file of files) {
    const windows = opened.get(file.filename) ?? [];
    opens.push({ filename: file.filename, opened: windows.length > 0 });
    const ranges = file.changedLineRanges?.RIGHT;
    if (!ranges) {
      if (file.patch === undefined && !windows.length)
        unread.push(file.filename);
      continue;
    }
    const added = ranges.reduce((n, r) => n + r.end - r.start + 1, 0);
    if (!added) continue;
    const got = ranges.reduce((n, r) => n + overlap(r, windows), 0);
    read += got;
    total += added;
    if (!got) unread.push(file.filename);
  }
  return { read, total, unread, files: opens };
}

export function evidenceTrail(
  cited: { path: string; line: number },
  files: CoverageFile[],
  activity: ActivityEntry[],
) {
  const reads = activity.flatMap((entry, index) =>
    entry.tool === "readFile" &&
    entry.path === cited.path &&
    entry.start !== undefined &&
    entry.end !== undefined &&
    entry.start <= cited.line &&
    cited.line <= entry.end
      ? [{ ordinal: index + 1, entry }]
      : [],
  );
  const inDiff = files.some(
    (f) =>
      f.filename === cited.path &&
      f.changedLineRanges?.RIGHT.some(
        (r) => r.start <= cited.line && cited.line <= r.end,
      ),
  );
  return { reads, inDiff };
}
