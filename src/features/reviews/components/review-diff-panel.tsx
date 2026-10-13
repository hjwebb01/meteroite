"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CodeViewDiffItem,
  DiffLineAnnotation,
  FileDiffMetadata,
} from "@pierre/diffs";
import {
  CodeView,
  type CodeViewHandle,
  type CodeViewReactOptions,
} from "@pierre/diffs/react";
import ChevronDown from "@boxicons/react/ChevronDown";
import ChevronUp from "@boxicons/react/ChevronUp";
import { Button } from "@/components/ui/button";
import type { Doc } from "../../../../convex/_generated/dataModel";
import {
  fileCoverageGaps,
  type Hotspot,
} from "../../../../convex/lib/review_navigation";
import {
  annotationKey,
  buildDiffItems,
  diffItemId,
  diffSideOf,
  navigationLocation,
  parseSavedDiffs,
  type ReviewFinding,
  type ReviewAnnotation,
  type ReviewNavigationTarget,
} from "../lib/review-diff";
import { fileAtCommitUrl } from "../lib/review";
import type { FindingVerdict } from "./finding-verdict-badge";
import { FindingCard } from "./finding-card";
import { ReviewFindingPanel } from "./review-finding-panel";
import { IconButton, InlineCode } from "./review-diff-parts";

const SOURCE_CSS = `
  :host {
    --diffs-dark-bg: var(--review-code) !important;
    --diffs-dark: var(--review-text) !important;
    --diffs-addition-color: var(--diff-add-fg);
    --diffs-deletion-color: var(--diff-del-fg);
    --diffs-modified-color: var(--review-text);
    --diffs-bg-addition-override: color-mix(in oklab, var(--review-code) 92%, var(--diff-add-fg));
    --diffs-bg-deletion-override: color-mix(in oklab, var(--review-code) 90%, var(--diff-del-fg));
    --diffs-font-family: var(--font-code-face), monospace; /* diff source is literal code — taste-skill-ignore */
    --diffs-header-font-family: var(--font-ui-face), system-ui, sans-serif;
    --diffs-font-size: 13px;
  }
  [data-line-annotation] { background: var(--review-code) !important; }
  [data-annotation-content] { padding: 0 !important; }
  [data-diffs-header] { background: var(--review-code); }
`;

function hasLine(
  file: FileDiffMetadata,
  line: number,
  side?: "LEFT" | "RIGHT",
) {
  return file.hunks.some((hunk) => {
    const start = side === "LEFT" ? hunk.deletionStart : hunk.additionStart;
    const count = side === "LEFT" ? hunk.deletionCount : hunk.additionCount;
    return line >= start && line < start + count;
  });
}

export interface ReviewDiffPanelProps {
  review: Doc<"reviews">;
  files: Doc<"reviewFiles">[];
  findings: ReviewFinding[];
  allFindings: ReviewFinding[];
  verdicts: Record<string, FindingVerdict>;
  activeFindingId: string | null;
  focus: ReviewNavigationTarget | null;
  hotspots: Hotspot[];
  onSelectFinding: (id: string | null) => void;
  onNavigate: (target: ReviewNavigationTarget) => void;
  onReviewLatest: () => void;
}

export default function ReviewDiffPanel({
  review,
  files,
  findings,
  allFindings,
  verdicts,
  activeFindingId,
  focus,
  hotspots,
  onSelectFinding,
  onNavigate,
  onReviewLatest,
}: ReviewDiffPanelProps) {
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const viewer = useRef<CodeViewHandle<ReviewAnnotation, undefined>>(null);
  const movedFocus = useRef<ReviewNavigationTarget | null>(null);
  const openingPosition = useRef<number | null>(null);
  const previousFinding = useRef<string | null>(null);
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const [split, setSplit] = useState(false);
  const [wide, setWide] = useState(false);
  const diffs = useMemo(() => parseSavedDiffs(files), [files]);
  const location = focus ? navigationLocation(focus) : null;
  const selectedDiff = diffs.find((diff) => diff.path === location?.path);
  const referenceMatches =
    (focus?.kind !== "reference" && focus?.kind !== "hotspot") ||
    focus.reference.commitSha ===
      (focus.reference.side === "LEFT" ? review.diffLeftSha : review.headSha);
  const available = Boolean(
    referenceMatches &&
    selectedDiff &&
    (location?.line === undefined ||
      hasLine(selectedDiff.fileDiff, location.line, location.side)),
  );
  const activeFinding = allFindings.find(
    (finding) => finding.id === activeFindingId,
  );
  const annotations = useMemo(() => {
    if (
      !activeFinding ||
      findings.some((finding) => finding.id === activeFinding.id)
    )
      return findings;
    return [...findings, activeFinding];
  }, [findings, activeFinding]);
  const items = useMemo(
    () =>
      buildDiffItems(
        diffs,
        annotations,
        toggled,
        hotspots,
        location?.path,
        allFindings,
      ).map((item): CodeViewDiffItem<ReviewAnnotation> => ({
        ...item,
        annotations: item.annotations?.filter(
          (annotation) =>
            hasLine(
              item.fileDiff,
              annotation.lineNumber,
              annotation.side === "deletions" ? "LEFT" : "RIGHT",
            ) &&
            (annotation.metadata.kind !== "hotspot" ||
              annotation.metadata.reference.commitSha ===
                (annotation.metadata.reference.side === "LEFT"
                  ? review.diffLeftSha
                  : review.headSha)),
        ),
      })),
    [
      diffs,
      annotations,
      toggled,
      hotspots,
      location?.path,
      allFindings,
      review.diffLeftSha,
      review.headSha,
    ],
  );
  const options = useMemo<CodeViewReactOptions<ReviewAnnotation, undefined>>(
    () => ({
      theme: "pierre-dark",
      diffStyle: wide && split ? "split" : "unified",
      stickyHeaders: true,
      overflow: "scroll",
      unsafeCSS: SOURCE_CSS,
      layout: { paddingTop: 0, paddingBottom: 24, gap: 12 },
    }),
    [wide, split],
  );

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setWide(entry.contentRect.width >= 1050),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (activeFindingId && !previousFinding.current)
      openingPosition.current = scroller.current?.scrollTop ?? null;
    if (!activeFindingId && previousFinding.current) {
      const marker = root.current?.querySelector<HTMLElement>(
        `[data-review-annotation="finding:${CSS.escape(previousFinding.current)}"]`,
      );
      marker?.focus({ preventScroll: true });
      if (openingPosition.current !== null)
        scroller.current?.scrollTo({
          top: openingPosition.current,
          behavior: "instant",
        });
      openingPosition.current = null;
    }
    previousFinding.current = activeFindingId;
  }, [activeFindingId]);

  useEffect(() => {
    if (!focus || movedFocus.current === focus) return;
    const target = navigationLocation(focus);
    if (!available) {
      root.current
        ?.querySelector<HTMLElement>("[data-unavailable-source]")
        ?.focus({ preventScroll: true });
      movedFocus.current = focus;
      return;
    }
    const id = diffItemId(target.path);
    if (target.line === undefined) {
      viewer.current?.clearSelectedLines();
      viewer.current?.scrollTo({
        type: "item",
        id,
        align: "start",
        behavior: "instant",
      });
    } else {
      const side = diffSideOf(target.side);
      viewer.current?.setSelectedLines({
        id,
        range: { start: target.line, end: target.line, side },
      });
      viewer.current?.scrollTo({
        type: "line",
        id,
        lineNumber: target.line,
        side,
        align: "center",
        behavior: "instant",
      });
    }
    let frame = 0;
    let attempts = 0;
    const selector = annotationKey(focus)
      ? `[data-review-annotation="${CSS.escape(annotationKey(focus)!)}"]`
      : `[data-review-file="${CSS.escape(target.path)}"]`;
    const moveFocus = () => {
      const node = root.current?.querySelector<HTMLElement>(selector);
      if (node) {
        node.focus({ preventScroll: true });
        movedFocus.current = focus;
      } else if (++attempts < 60) frame = requestAnimationFrame(moveFocus);
    };
    frame = requestAnimationFrame(moveFocus);
    return () => cancelAnimationFrame(frame);
  }, [focus, available]);

  function step(direction: number) {
    if (!findings.length) return;
    const index = findings.findIndex(
      (finding) => finding.id === activeFindingId,
    );
    onSelectFinding(
      findings[(index + direction + findings.length) % findings.length].id,
    );
  }

  function inspection(finding: ReviewFinding) {
    return (
      <div className="min-w-0 space-y-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-review-muted">
          <span className="break-all">
            {finding.path}:{finding.line} ({finding.side ?? "RIGHT"}) · saved{" "}
            {(finding.side === "LEFT"
              ? review.diffLeftSha
              : review.headSha
            )?.slice(0, 7) ?? "revision unavailable"}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onSelectFinding(null)}
          >
            Close inspection
          </Button>
        </div>
        <FindingCard
          finding={finding}
          verdict={verdicts[finding.id]}
          review={review}
          active
          context
          onDiscuss={() => onSelectFinding(finding.id)}
        />
        {finding.evidence.length > 0 && (
          <details className="rounded-md border border-review-border p-3 text-xs">
            <summary className="cursor-pointer py-1">
              Visit supporting source in this workspace
            </summary>
            <p className="mt-2 text-review-muted">
              Supporting evidence may be elsewhere, not on the finding’s anchor
              line.
            </p>
            <div className="mt-2 space-y-2">
              {finding.evidence.map((evidence, index) => {
                const left = Boolean(
                  evidence.commitSha &&
                  evidence.commitSha === review.diffLeftSha,
                );
                const file = files.find(
                  (entry) =>
                    entry.filename === evidence.path ||
                    entry.previousFilename === evidence.path,
                );
                return (
                  <button
                    key={index}
                    type="button"
                    onClick={() =>
                      onNavigate({
                        kind: "reference",
                        reference: {
                          path: file?.filename ?? evidence.path,
                          sourcePath: evidence.path,
                          line: evidence.line,
                          side: left ? "LEFT" : "RIGHT",
                          commitSha: evidence.commitSha ?? review.headSha ?? "",
                          blobSha: evidence.blobSha,
                        },
                      })
                    }
                    className="block min-h-9 rounded-md text-left text-review-link underline focus-visible:outline-2 focus-visible:outline-review-link"
                  >
                    {evidence.path}:{evidence.line} ({left ? "LEFT" : "RIGHT"})
                    ·{" "}
                    {evidence.commitSha?.slice(0, 7) ??
                      review.headSha?.slice(0, 7) ??
                      "revision unavailable"}
                  </button>
                );
              })}
            </div>
          </details>
        )}
        <ReviewFindingPanel
          key={finding.id}
          review={review}
          finding={finding}
          onReviewLatest={onReviewLatest}
        />
      </div>
    );
  }

  function renderAnnotation({
    metadata,
  }: DiffLineAnnotation<ReviewAnnotation>) {
    const key = annotationKey(metadata);
    if (metadata.kind === "finding") {
      const finding = metadata.finding;
      const expanded = finding.id === activeFindingId;
      return (
        <section
          data-review-annotation={key}
          tabIndex={-1}
          aria-label={`Finding: ${finding.title}`}
          className="min-w-0 border-y border-review-border bg-review-code font-sans text-review-text focus-visible:outline-2 focus-visible:outline-review-link"
        >
          {expanded ? (
            inspection(finding)
          ) : (
            <button
              type="button"
              aria-expanded={false}
              onClick={() => onSelectFinding(finding.id)}
              className="flex min-h-10 w-full flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 text-left text-xs hover:bg-review-reading focus-visible:outline-2 focus-visible:outline-review-link"
            >
              <span className="font-semibold">
                {finding.severity} severity · {finding.side ?? "RIGHT"}{" "}
                {finding.line}
              </span>
              <span className="min-w-0 break-words text-review-link">
                <InlineCode text={finding.title} />
              </span>
              {verdicts[finding.id] === "incorrect" && (
                <span className="text-review-muted">
                  Retracted by investigation
                </span>
              )}
            </button>
          )}
        </section>
      );
    }
    const expanded = focus?.kind === "hotspot" && annotationKey(focus) === key;
    return (
      <section
        data-review-annotation={key}
        tabIndex={-1}
        className="border-y border-review-border bg-review-code p-3 text-xs text-review-text"
      >
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => onNavigate(metadata)}
          className="min-h-9 text-left text-review-link underline"
        >
          {metadata.hotspot.kind === "human_judgment"
            ? "Human judgment"
            : "Possible issue"}
          : {metadata.hotspot.title}
        </button>
        {expanded && (
          <p className="mt-2 whitespace-pre-wrap leading-6 text-review-body">
            {metadata.hotspot.reason}
          </p>
        )}
      </section>
    );
  }

  const sourceUrl =
    location &&
    (() => {
      const left = location.side === "LEFT";
      const sha =
        focus?.kind === "hotspot" || focus?.kind === "reference"
          ? focus.reference.commitSha
          : left
            ? review.diffLeftSha
            : review.headSha;
      if (!sha) return undefined;
      const file = files.find((entry) => entry.filename === location.path);
      return fileAtCommitUrl(
        left ? review.repoOwner : (review.sourceOwner ?? review.repoOwner),
        left ? review.repoName : (review.sourceRepo ?? review.repoName),
        sha,
        focus?.kind === "hotspot" || focus?.kind === "reference"
          ? focus.reference.sourcePath
          : left
            ? (file?.previousFilename ?? location.path)
            : location.path,
        location.line ?? 1,
      );
    })();

  return (
    <div
      ref={root}
      className="review-source-plane flex min-w-0 flex-col text-review-text"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-review-border bg-review-chrome px-3 py-2">
        <span className="text-xs text-review-muted">
          Saved source · {review.headSha?.slice(0, 7) ?? "revision unavailable"}
        </span>
        <div className="flex items-center gap-2">
          {wide && (
            <Button
              size="sm"
              variant="outline"
              aria-pressed={split}
              onClick={() => setSplit(!split)}
            >
              {split ? "Unified diff" : "Split comparison"}
            </Button>
          )}
          <span className="text-xs text-review-muted">
            {findings.length} findings
          </span>
          <IconButton label="Previous finding" onClick={() => step(-1)}>
            <ChevronUp aria-hidden width={18} height={18} />
          </IconButton>
          <IconButton label="Next finding" onClick={() => step(1)}>
            <ChevronDown aria-hidden width={18} height={18} />
          </IconButton>
        </div>
      </div>
      {location && (
        <p className="border-b border-review-border bg-review-code px-3 py-2 text-xs leading-5 text-review-muted">
          <span className="break-all">{location.path}</span>
          {location.line !== undefined &&
            ` (${location.side ?? "RIGHT"} line ${location.line})`}
          {focus?.kind === "group" || focus?.kind === "hunk"
            ? ` · saved hunk ${focus.hunk.ordinal + 1}`
            : ""}
        </p>
      )}
      {activeFinding && focus?.kind !== "finding" && (
        <div className="border-b border-review-border px-3 py-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onSelectFinding(activeFinding.id)}
          >
            Return to finding: {activeFinding.title}
          </Button>
        </div>
      )}
      {focus && !available && (
        <section
          data-unavailable-source
          tabIndex={-1}
          className="border-b border-review-border p-4 focus-visible:outline-2 focus-visible:outline-review-link"
        >
          <h3 className="text-sm font-semibold">
            Exact saved source unavailable
          </h3>
          <p className="mt-2 break-all text-xs leading-6 text-review-muted">
            {location?.path}
            {location?.line !== undefined &&
              `:${location.line} (${location.side ?? "RIGHT"})`}{" "}
            {referenceMatches
              ? "is not present in the saved text patch."
              : "belongs to a different recorded revision than this saved patch."}{" "}
            No nearby line or revision has been substituted.
          </p>
          {files.find((file) => file.filename === location?.path) &&
            fileCoverageGaps(
              files.find((file) => file.filename === location?.path)!,
            ).map((gap) => (
              <p key={gap.kind} className="mt-2 text-xs text-review-muted">
                {gap.reason}
              </p>
            ))}
          {sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block text-xs text-review-link underline"
            >
              Open exact pinned source on GitHub
            </a>
          )}
          {focus.kind === "finding" &&
            (activeFindingId === focus.finding.id ? (
              inspection(focus.finding)
            ) : (
              <Button
                size="sm"
                variant="outline"
                data-review-annotation={annotationKey(focus)}
                onClick={() => onSelectFinding(focus.finding.id)}
              >
                Inspect finding: {focus.finding.title}
              </Button>
            ))}
          {focus.kind === "hotspot" && (
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-review-body">
              {focus.hotspot.reason}
            </p>
          )}
        </section>
      )}
      {diffs.length ? (
        <CodeView<ReviewAnnotation, undefined>
          ref={viewer}
          containerRef={scroller}
          items={items}
          options={options}
          renderAnnotation={(annotation) =>
            renderAnnotation(annotation as DiffLineAnnotation<ReviewAnnotation>)
          }
          renderCustomHeader={(item) =>
            item.type === "diff" && (
              <div className="flex min-w-0 flex-wrap items-center gap-2 bg-review-file-header px-3 py-2 text-xs">
                <h3
                  data-review-file={item.fileDiff.name}
                  tabIndex={-1}
                  className="min-w-0 flex-1 break-all focus-visible:outline-2 focus-visible:outline-review-link"
                >
                  <code>{item.fileDiff.name}</code>
                </h3>
                {item.fileDiff.name === location?.path ? (
                  <span className="text-review-link">Selected source</span>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-expanded={!item.collapsed}
                    onClick={() =>
                      setToggled((current) => {
                        const next = new Set(current);
                        if (!next.delete(item.fileDiff.name))
                          next.add(item.fileDiff.name);
                        return next;
                      })
                    }
                  >
                    {item.collapsed ? "Open diff" : "Collapse"}
                  </Button>
                )}
              </div>
            )
          }
          className="h-[72dvh] min-h-96 min-w-0 overflow-auto"
        />
      ) : (
        <p className="p-5 text-sm leading-6 text-review-muted">
          No text patches were saved for this review. The complete available
          file inventory and coverage limits remain in All changes.
        </p>
      )}
    </div>
  );
}
