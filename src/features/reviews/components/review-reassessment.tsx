"use client";

import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import type { ReviewNavigationTarget } from "../lib/review-diff";
import { fileAtCommitUrl } from "../lib/review";
import { ReviewAssessment } from "./review-assessment";
import { Button } from "@/components/ui/button";

function assessmentLabel(review: Doc<"reviews">) {
  const assessment = review.result?.assessment;
  return !assessment
    ? "Assessment unavailable (older review)"
    : assessment.state === "incomplete"
      ? "Incomplete assessment · no numeric score"
      : `Scrutiny ${assessment.score}/5 · ${assessment.readiness.state.replaceAll("_", " ")}`;
}

export function ReviewReassessment({
  review,
  previous,
  files,
  onOpenReview,
  onNavigate,
}: {
  review: Doc<"reviews">;
  previous: Doc<"reviews">;
  files: Doc<"reviewFiles">[];
  onOpenReview: (id: Id<"reviews">, findingId?: string) => void;
  onNavigate: (target: ReviewNavigationTarget) => void;
}) {
  function contextSourceUrl(path: string) {
    const file = files.find((entry) => entry.filename === path);
    const removed = file?.status === "removed";
    const sha = removed ? review.diffLeftSha : review.headSha;
    if (!sha) return undefined;
    return fileAtCommitUrl(
      removed ? review.repoOwner : (review.sourceOwner ?? review.repoOwner),
      removed ? review.repoName : (review.sourceRepo ?? review.repoName),
      sha,
      removed ? (file.previousFilename ?? path) : path,
      1,
    );
  }
  const comparison = review.result?.reassessment;
  const renewed = comparison?.contexts.filter(
    (context) => context.state !== "unchanged",
  ).length;
  return (
    <section
      className="mb-7 rounded-lg border bg-sidebar p-5"
      aria-label="Snapshot reassessment"
    >
      <h2 className="font-semibold">Compared with the prior snapshot</h2>
      <dl className="mt-3 space-y-3 text-xs">
        <div>
          <dt className="text-muted-foreground">
            Current · {review.headSha?.slice(0, 7) ?? "unpinned"}
          </dt>
          <dd className="mt-1">{assessmentLabel(review)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            Prior · {previous.headSha?.slice(0, 7) ?? "unpinned"}
          </dt>
          <dd className="mt-1">{assessmentLabel(previous)}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        This assessment comes from the current PR code. Prior discussions and
        conclusions describe their recorded source snapshot; unchanged
        supporting code does not verify an earlier conclusion.
      </p>
      <Button
        size="xs"
        variant="outline"
        className="mt-3"
        onClick={() => onOpenReview(previous._id)}
      >
        Open prior review and discussions
      </Button>
      {!comparison && (
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          This saved run has no supporting-code comparison. Earlier context
          needs reassessment.
        </p>
      )}
      {comparison && (
        <>
          <p className="mt-4 text-sm">
            {renewed} prior contexts need renewed attention.
          </p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {comparison.absentFindingIds.length} prior findings are absent from
            this run. Absence does not prove they were fixed.
          </p>
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-medium">
              Supporting-code comparison · {comparison.contexts.length} contexts
            </summary>
            <ul className="mt-3 space-y-4">
              {comparison.contexts.map((context) => {
                const source =
                  context.kind === "finding"
                    ? previous.result?.findings.find(
                        (finding) => finding.id === context.sourceId,
                      )
                    : context.kind === "hotspot"
                      ? previous.result?.hotspots?.find(
                          (hotspot) => hotspot.id === context.sourceId,
                        )
                      : previous.result?.changeGroups?.find(
                          (group) => group.id === context.sourceId,
                        );
                return (
                  <li
                    key={`${context.kind}:${context.sourceId}`}
                    className="rounded border p-3"
                  >
                    <p className="text-xs font-medium">
                      {source?.title ?? `Prior ${context.kind}`} ·{" "}
                      {context.state === "unchanged"
                        ? "Supporting code unchanged"
                        : context.state === "changed"
                          ? "Supporting code changed"
                          : "Match ambiguous"}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      {context.reason}
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        onOpenReview(
                          previous._id,
                          context.kind === "finding"
                            ? context.sourceId
                            : undefined,
                        )
                      }
                      className="mt-2 rounded text-xs text-blue-300 underline focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      Open prior{" "}
                      {context.kind === "finding"
                        ? "finding and discussion"
                        : context.kind}
                    </button>
                    <div className="mt-2 space-y-1">
                      {context.currentPaths.map((path) =>
                        files.some(
                          (file) => file.filename === path && file.patch,
                        ) ? (
                          <button
                            key={path}
                            type="button"
                            onClick={() => onNavigate({ kind: "file", path })}
                            className="block rounded break-all font-mono text-xs text-blue-300 underline focus-visible:outline-2 focus-visible:outline-ring"
                          >
                            Current diff: {path}
                          </button>
                        ) : (
                          <a
                            key={path}
                            href={contextSourceUrl(path)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block break-all font-mono text-xs text-blue-300 underline"
                          >
                            {contextSourceUrl(path)
                              ? "Current pinned source"
                              : "Current source unavailable"}
                            : {path}
                          </a>
                        ),
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </details>
        </>
      )}
      <details className="mt-4">
        <summary className="cursor-pointer text-xs font-medium">
          Prior assessment at{" "}
          {previous.headSha?.slice(0, 7) ?? "its saved snapshot"}
        </summary>
        <div className="mt-3">
          <ReviewAssessment
            heading="Prior PR assessment"
            assessment={previous.result?.assessment}
            sourceOwner={previous.sourceOwner ?? previous.repoOwner}
            sourceRepo={previous.sourceRepo ?? previous.repoName}
          />
        </div>
      </details>
    </section>
  );
}
