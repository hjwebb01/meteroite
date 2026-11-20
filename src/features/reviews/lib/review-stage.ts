export type ReviewStageName = "load" | "investigate" | "finish";

type StageRun = {
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  stage?: ReviewStageName;
  parts?: number;
  partsDone?: number;
};

export function reviewStageName(
  run: Pick<StageRun, "stage" | "parts" | "partsDone">,
): string | null {
  if (!run.stage) return null;
  if (run.stage === "load") return "Loading pull request";
  if (run.stage === "finish") return "Finishing review";
  return run.parts
    ? `Investigating in ${run.parts} parts, ${Math.min(run.partsDone ?? 0, run.parts)} done`
    : "Investigating changes";
}

export function reviewStageLabel(run: StageRun): string | null {
  if (run.status === "completed") return null;
  const name = reviewStageName(run);
  if (!name) return run.status === "queued" ? "Queued" : null;
  if (run.status === "failed") return `${name} · failed`;
  if (run.status === "cancelled") return `${name} · cancelled`;
  return name;
}

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes} min ${seconds % 60} s` : `${seconds} s`;
}
