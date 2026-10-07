"use client";

import type { Doc } from "../../../../convex/_generated/dataModel";
import type { Hotspot } from "../../../../convex/lib/review_navigation";
import { fileCoverageGaps } from "../../../../convex/lib/review_navigation";
import type { ReviewNavigationTarget } from "../lib/review-diff";
import { fileAtCommitUrl } from "../lib/review";

export function ReviewHotspots({
  review,
  files,
  onSelect,
}: {
  review: Doc<"reviews">;
  files: Doc<"reviewFiles">[];
  onSelect: (
    target: Extract<ReviewNavigationTarget, { kind: "hotspot" }>,
  ) => void;
}) {
  const hotspots: Hotspot[] = review.result?.hotspots ?? [];
  return (
    <section className="mb-7" aria-label="Review hotspots">
      <h2 className="text-lg font-semibold">
        Hotspots{" "}
        <span className="text-muted-foreground">{hotspots.length}</span>
      </h2>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        Areas that deserve attention. A hotspot can need human judgment without
        a validated defect.
      </p>
      {hotspots.map((hotspot) => (
        <article key={hotspot.id} className="mt-3 rounded-lg border p-4">
          <p className="text-xs text-blue-300">
            {hotspot.kind === "human_judgment"
              ? "Human judgment"
              : "Possible issue"}
          </p>
          <h3 className="mt-1 font-medium">{hotspot.title}</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {hotspot.reason}
          </p>
          <div className="mt-3 flex flex-col items-start gap-2">
            {hotspot.references.map((reference, index) => {
              const available = files.some(
                (file) => file.filename === reference.path && file.patch,
              );
              const owner =
                reference.side === "LEFT"
                  ? review.repoOwner
                  : (review.sourceOwner ?? review.repoOwner);
              const repo =
                reference.side === "LEFT"
                  ? review.repoName
                  : (review.sourceRepo ?? review.repoName);
              return (
                <div key={index} className="text-xs">
                  <button
                    type="button"
                    onClick={() =>
                      onSelect({ kind: "hotspot", hotspot, reference })
                    }
                    className="rounded px-1 py-1 text-blue-300 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {available ? "Show in diff" : "Show context"}:{" "}
                    {reference.path}:{reference.line} ({reference.side})
                  </button>
                  {" · "}
                  <a
                    href={fileAtCommitUrl(
                      owner,
                      repo,
                      reference.commitSha,
                      reference.sourcePath,
                      reference.line,
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground underline"
                  >
                    Pinned source
                  </a>
                </div>
              );
            })}
          </div>
        </article>
      ))}
      {files.some((file) => fileCoverageGaps(file).length) && (
        <details className="mt-4 rounded-lg border p-4 text-xs text-muted-foreground">
          <summary className="cursor-pointer">File coverage limits</summary>
          <ul className="mt-3 space-y-3">
            {files.flatMap((file) =>
              fileCoverageGaps(file).map((gap) => (
                <li key={`${file.filename}:${gap.kind}`}>
                  <span className="block break-all font-mono">
                    {file.filename}
                  </span>
                  <span>
                    {gap.kind === "model_context_omitted"
                      ? "Model context omitted"
                      : gap.kind === "display_size_excluded"
                        ? "Display size excluded"
                        : "Text patch unavailable"}
                    : {gap.reason}
                  </span>
                </li>
              )),
            )}
          </ul>
        </details>
      )}
    </section>
  );
}
