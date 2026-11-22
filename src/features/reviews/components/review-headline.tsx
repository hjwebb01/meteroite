import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { computeCoverage, type CoverageFile } from "../lib/review-coverage";
import type { ActivityEntry } from "../lib/review-activity";
import { estimateText } from "../lib/review-estimate";
import { formatElapsed } from "../lib/review-stage";

export function ReviewHeadline({
  stage,
  elapsedMs,
  files,
  activity,
}: {
  stage: string;
  elapsedMs: number;
  files?: CoverageFile[];
  activity: ActivityEntry[];
}) {
  const coverage = useMemo(
    () => files && computeCoverage(files, activity),
    [files, activity],
  );
  return (
    <div className="mt-4 space-y-3">
      <p className="text-sm font-medium tabular-nums text-review-body">
        {stage} · {formatElapsed(elapsedMs)} · {estimateText(elapsedMs)}
      </p>
      {coverage && coverage.total > 0 && (
        <p className="text-xs text-review-muted tabular-nums">
          Read {coverage.read} of {coverage.total} changed lines (
          {Math.round((coverage.read / coverage.total) * 100)}%)
        </p>
      )}
      {coverage && (
        <ul aria-label="Changed files" className="flex flex-wrap gap-1.5">
          {coverage.files.map((file) => (
            <li
              key={file.filename}
              title={file.filename}
              className={cn(
                "max-w-48 truncate rounded border px-2 py-0.5 font-mono text-xs",
                file.opened
                  ? "border-review-link text-review-body"
                  : "border-review-border text-review-muted",
              )}
            >
              {file.opened ? "✓ " : ""}
              {file.filename.split("/").pop()}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
