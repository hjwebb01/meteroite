"use client";

import dynamic from "next/dynamic";
import { useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import {
  savedHunks,
  ungroupedHunks,
  fileCoverageGaps,
  type ChangeGroup,
  type ChangeHunk,
} from "../../../../convex/lib/review_navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  navigationLocation,
  type ReviewFinding,
  type ReviewNavigationTarget,
} from "../lib/review-diff";
import { isNitpick, sortFindings } from "../lib/finding-presentation";
import type { FindingVerdict } from "./finding-verdict-badge";
import { ReviewNavigation } from "./review-navigation";
import { ReviewAssessment } from "./review-assessment";
import { ReviewHotspots } from "./review-hotspots";
import { ReviewReassessment } from "./review-reassessment";
import styles from "./review-reader.module.css";
import { DiscussionSessions } from "./discussion-sessions";

const ReviewDiffPanel = dynamic(() => import("./review-diff-panel"), {
  ssr: false,
  loading: () => (
    <p role="status" className="p-5 text-sm text-review-muted">
      Loading saved source…
    </p>
  ),
});

export interface ReviewReaderProps {
  review: Doc<"reviews">;
  files: Doc<"reviewFiles">[];
  verdicts?: Record<string, FindingVerdict>;
  previous: Doc<"reviews"> | null;
  initialFindingId: string | null;
  onRerun: () => void;
  onSelectReview: (id: Id<"reviews">, findingId?: string) => void;
  /** Saved evidence is available during activity without implying a generated result. */
  sourceOnly?: boolean;
}

export function ReviewReader(props: ReviewReaderProps) {
  return (
    <DiscussionSessions
      key={`${props.review._id}:${props.review.headSha ?? "legacy"}`}
    >
      <SavedReviewReader
        key={`${props.review._id}:${props.review.headSha ?? "legacy"}:${props.initialFindingId ?? "brief"}`}
        {...props}
      />
    </DiscussionSessions>
  );
}

function SavedReviewReader({
  review,
  files,
  verdicts = {},
  previous,
  initialFindingId,
  onRerun,
  onSelectReview,
  sourceOnly = false,
}: ReviewReaderProps) {
  const result = review.result;
  const readerId = useId();
  const initialFinding = result?.findings.find(
    (finding) => finding.id === initialFindingId,
  );
  const [reading, setReading] = useState(sourceOnly || Boolean(initialFinding));
  const [focus, setFocus] = useState<ReviewNavigationTarget | null>(
    initialFinding
      ? { kind: "finding", finding: initialFinding }
      : files[0] && sourceOnly
        ? { kind: "file", path: files[0].filename }
        : null,
  );
  const [activeFindingId, setActiveFindingId] = useState<string | null>(
    initialFinding?.id ?? null,
  );
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "high" | "medium" | "low">(
    "all",
  );
  const [pendingMarks, setPendingMarks] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [markError, setMarkError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const brief = useRef<HTMLHeadingElement>(null);
  const source = useRef<HTMLDivElement>(null);
  const inventory = useRef<HTMLHeadingElement>(null);
  const inventoryTrigger = useRef<HTMLButtonElement>(null);
  const readIds = useQuery(api.reviews.readSections, { id: review._id });
  const markSection = useMutation(api.reviews.setSectionRead);
  const hunks = useMemo(
    () => savedHunks(files, `legacy:${review._id}`),
    [files, review._id],
  );
  const groups = result?.changeGroups ?? [];
  const ungrouped = ungroupedHunks(hunks, groups);
  const byHunk = useMemo(
    () => new Map(hunks.map((hunk) => [hunk.id, hunk])),
    [hunks],
  );
  const selectedGroup = groups.find((group) => group.id === selectedGroupId);
  const allFindings = useMemo(
    () => sortFindings(result?.findings ?? []),
    [result?.findings],
  );
  const findings = allFindings.filter(
    (finding) => filter === "all" || finding.severity === filter,
  );
  const readCount = groups.filter((group) =>
    readIds?.includes(group.id),
  ).length;
  const gaps = files.flatMap((file) =>
    fileCoverageGaps(file).map((gap) => ({ path: file.filename, ...gap })),
  );
  const missingFiles = result
    ? Math.max(0, result.coverage.changedFiles - files.length)
    : 0;

  function navigate(target: ReviewNavigationTarget) {
    setFocus(target);
    if (target.kind === "finding") setActiveFindingId(target.finding.id);
    if (target.kind === "group") setSelectedGroupId(target.group.id);
    else {
      const location = navigationLocation(target);
      const matching = hunks.find(
        (hunk) =>
          hunk.path === location.path &&
          (location.line === undefined ||
            (location.side === "LEFT"
              ? location.line >= hunk.leftStart &&
                location.line < hunk.leftStart + hunk.leftLines
              : location.line >= hunk.rightStart &&
                location.line < hunk.rightStart + hunk.rightLines)),
      );
      setSelectedGroupId(
        matching
          ? (groups.find((group) => group.hunkIds.includes(matching.id))?.id ??
              null)
          : null,
      );
    }
    setInventoryOpen(false);
    setReading(true);
    requestAnimationFrame(() => {
      source.current?.focus({ preventScroll: true });
      source.current?.scrollIntoView({ block: "start", behavior: "instant" });
    });
  }

  function selectFinding(id: string | null) {
    if (id === null) {
      setActiveFindingId(null);
      return;
    }
    const finding = allFindings.find((entry) => entry.id === id);
    if (finding) navigate({ kind: "finding", finding });
  }

  function returnToBrief() {
    setReading(false);
    setInventoryOpen(false);
    requestAnimationFrame(() => {
      brief.current?.focus({ preventScroll: true });
      brief.current?.scrollIntoView({ block: "start", behavior: "instant" });
    });
  }

  function toggleInventory() {
    const open = !inventoryOpen;
    setInventoryOpen(open);
    requestAnimationFrame(() => {
      const target = open ? inventory.current : inventoryTrigger.current;
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({
        block: open ? "start" : "nearest",
        behavior: "instant",
      });
    });
  }

  async function toggleRead(group: ChangeGroup) {
    if (!review.headSha || readIds === undefined || pendingMarks.has(group.id))
      return;
    const read = !readIds.includes(group.id);
    setMarkError("");
    setPendingMarks((current) => new Set(current).add(group.id));
    try {
      await markSection({
        id: review._id,
        headSha: review.headSha,
        groupId: group.id,
        read,
      });
      setAnnouncement(
        `${group.title} marked ${read ? "read" : "unread"} at saved revision ${review.headSha.slice(0, 7)}.`,
      );
    } catch (error) {
      setMarkError(
        error instanceof Error
          ? error.message
          : "Reading mark could not be saved.",
      );
    } finally {
      setPendingMarks((current) => {
        const next = new Set(current);
        next.delete(group.id);
        return next;
      });
    }
  }

  function markControl(group: ChangeGroup) {
    return (
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="text-review-muted">
          {readIds === undefined
            ? "Loading reading state…"
            : readIds.includes(group.id)
              ? "Read at this revision"
              : "Unread"}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={
            !review.headSha ||
            readIds === undefined ||
            pendingMarks.has(group.id)
          }
          onClick={() => void toggleRead(group)}
        >
          {pendingMarks.has(group.id)
            ? "Saving…"
            : readIds?.includes(group.id)
              ? "Mark unread"
              : "Mark read"}
        </Button>
      </div>
    );
  }

  function sourceLink(hunk: ChangeHunk, group: ChangeGroup) {
    return (
      <button
        key={hunk.id}
        type="button"
        onClick={() => navigate({ kind: "group", group, hunk })}
        className="block min-h-10 w-full rounded-md px-2 py-2 text-left text-xs leading-5 text-review-link hover:bg-review-reading focus-visible:outline-2 focus-visible:outline-review-link"
      >
        <span className="block break-all">{hunk.path}</span>
        <span className="text-review-muted">
          Hunk {hunk.ordinal + 1} · LEFT {hunk.leftStart},{hunk.leftLines},
          RIGHT {hunk.rightStart},{hunk.rightLines}
        </span>
      </button>
    );
  }

  function section(group: ChangeGroup, compact: boolean) {
    const members = group.hunkIds.flatMap((id) => {
      const hunk = byHunk.get(id);
      return hunk ? [hunk] : [];
    });
    const groupFindings = allFindings.filter((finding) =>
      members.some(
        (hunk) =>
          hunk.path === finding.path &&
          (finding.side === "LEFT"
            ? finding.line >= hunk.leftStart &&
              finding.line < hunk.leftStart + hunk.leftLines
            : finding.line >= hunk.rightStart &&
              finding.line < hunk.rightStart + hunk.rightLines),
      ),
    );
    const selected = selectedGroupId === group.id;
    return (
      <article
        key={group.id}
        className={cn(
          "min-w-0 rounded-md border border-review-border p-4",
          selected && "border-review-link",
          compact ? "bg-review-chrome" : "review-reading-plane",
        )}
      >
        <h3 className="text-sm font-semibold leading-6">
          <button
            type="button"
            onClick={() =>
              members[0]
                ? navigate({ kind: "group", group, hunk: members[0] })
                : setSelectedGroupId(group.id)
            }
            aria-current={selected ? "location" : undefined}
            className="min-h-9 text-left text-review-link focus-visible:outline-2 focus-visible:outline-review-link"
          >
            {group.title}
            {selected && <span className="sr-only"> · selected section</span>}
          </button>
        </h3>
        {(!compact || selected) && (
          <>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-review-body">
              {group.purpose}
            </p>
            <p className="mt-3 text-xs text-review-muted">
              {members.length} saved hunks · {groupFindings.length} findings
            </p>
            <div className="mt-3">{markControl(group)}</div>
            <details className="mt-3" open={!compact}>
              <summary className="cursor-pointer py-2 text-xs text-review-muted">
                Exact source grounding
              </summary>
              <div className="mt-1">
                {members.map((hunk) => sourceLink(hunk, group))}
              </div>
              {members.length < group.hunkIds.length && (
                <p className="mt-2 text-xs leading-5 text-review-muted">
                  {group.hunkIds.length - members.length} referenced hunks are
                  unavailable in this saved inventory. No substitute source is
                  shown.
                </p>
              )}
            </details>
          </>
        )}
        {compact && !selected && (
          <p className="text-xs text-review-muted">
            {readIds === undefined
              ? "Reading state loading"
              : readIds.includes(group.id)
                ? "Read"
                : "Unread"}{" "}
            · {members.length} hunks
          </p>
        )}
      </article>
    );
  }

  const inventoryControls = (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        ref={inventoryTrigger}
        variant="outline"
        size="sm"
        aria-expanded={inventoryOpen}
        aria-controls={`${readerId}-inventory`}
        onClick={toggleInventory}
        className="h-auto min-h-10 max-w-full whitespace-normal"
      >
        All changes · {files.length} saved files
      </Button>
      <span className="text-xs text-review-muted">
        Ungrouped · {ungrouped.length} hunks
      </span>
    </div>
  );

  function findingEntry(finding: ReviewFinding) {
    return (
      <li key={finding.id}>
        <button
          type="button"
          onClick={() => selectFinding(finding.id)}
          className="flex min-h-11 w-full flex-col gap-1 rounded-md border border-review-border px-3 py-2 text-left text-xs hover:bg-review-reading focus-visible:outline-2 focus-visible:outline-review-link"
        >
          <span className="text-review-link">{finding.title}</span>
          <span className="break-all text-review-muted">
            {finding.severity} severity · {finding.path}:{finding.line} (
            {finding.side ?? "RIGHT"})
            {verdicts[finding.id] === "incorrect" && ", retracted"}
          </span>
        </button>
      </li>
    );
  }

  return (
    <section
      aria-label={
        sourceOnly ? "Saved source reader" : "Change brief and source"
      }
      className={cn(styles.reader, "min-w-0 text-review-text")}
    >
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {markError && (
        <p
          role="alert"
          className="mb-4 rounded-md border border-destructive p-3 text-sm text-destructive"
        >
          {markError} The failed reading mark has not been saved.
        </p>
      )}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {inventoryControls}
        {reading && !sourceOnly && (
          <Button
            size="sm"
            variant="outline"
            className="h-auto min-h-10 max-w-full whitespace-normal"
            onClick={returnToBrief}
          >
            Return to change brief
          </Button>
        )}
        {!reading && focus && (
          <Button
            size="sm"
            variant="outline"
            className="h-auto min-h-10 max-w-full whitespace-normal"
            onClick={() => {
              setReading(true);
              requestAnimationFrame(() =>
                source.current?.focus({ preventScroll: true }),
              );
            }}
          >
            Resume saved source
          </Button>
        )}
      </div>
      {inventoryOpen && (
        <section
          id={`${readerId}-inventory`}
          className="review-reading-plane mb-5 rounded-md p-4"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2
              ref={inventory}
              tabIndex={-1}
              className="scroll-mt-36 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-review-link sm:scroll-mt-24"
            >
              Complete saved file and hunk inventory
            </h2>
            <Button
              size="sm"
              variant="outline"
              className="h-auto min-h-8 max-w-full whitespace-normal"
              onClick={toggleInventory}
            >
              Close inventory
            </Button>
          </div>
          <ReviewNavigation
            review={review}
            files={files}
            focus={focus}
            onNavigate={navigate}
          />
        </section>
      )}
      <div className={cn(styles.composition, reading && styles.reading)}>
        {!sourceOnly && (
          <aside
            className={cn(
              styles.brief,
              reading ? "review-glass" : "review-reading-plane",
            )}
            aria-label={
              reading ? "Context spine" : "Purpose-based change brief"
            }
          >
            <div className="p-4 sm:p-5">
              <h2
                ref={brief}
                tabIndex={-1}
                className="scroll-mt-36 text-lg font-semibold leading-7 focus-visible:outline-2 focus-visible:outline-review-link sm:scroll-mt-24"
              >
                {reading ? "Change context" : "Understand this change"}
              </h2>
              <p className="mt-2 break-all text-xs leading-5 text-review-muted">
                {review.repoOwner}/{review.repoName} #{review.pullNumber} ·
                saved {review.headSha?.slice(0, 7) ?? "revision unavailable"}
              </p>
              <p className="mt-4 text-xs font-semibold text-review-link">
                Generated change brief
              </p>
              <p className="mt-2 text-xs leading-5 text-review-muted">
                A generated interpretation grounded in saved source, not
                verified author intent.
              </p>
              {!reading && result && (
                <p className="mt-5 max-w-[76ch] whitespace-pre-wrap text-sm leading-7 text-review-body">
                  {result.summary}
                </p>
              )}
              {groups.length > 0 && (
                <p className="mt-4 text-xs leading-5 text-review-muted">
                  {readIds === undefined
                    ? "Loading saved reading marks…"
                    : `${readCount} of ${groups.length} purpose sections marked read.`}{" "}
                  Reading marks acknowledge source, not correctness or the whole
                  PR.
                </p>
              )}
              {!groups.length && (
                <p className="mt-4 text-sm leading-6 text-review-muted">
                  No usable generated purpose sections were saved. All available
                  source is reachable through All changes; no sections or
                  reading completion have been invented.
                </p>
              )}
              <div
                className={cn("mt-5", reading ? "space-y-3" : styles.sections)}
              >
                {groups.map((group) => section(group, reading))}
              </div>
              <p className="mt-5 text-xs leading-5 text-review-muted">
                {ungrouped.length} ungrouped saved hunks remain outside the
                purpose sections.
              </p>
              {(gaps.length > 0 || missingFiles > 0 || !files.length) && (
                <p className="mt-3 text-xs leading-5 text-review-muted">
                  Saved evidence is incomplete:{" "}
                  {missingFiles > 0 &&
                    `${missingFiles} changed files are absent; `}
                  {gaps.length > 0 && `${gaps.length} file coverage gaps; `}
                  {!files.length && "this review has no saved file inventory; "}
                  see All changes and machine coverage limits.
                </p>
              )}
            </div>
          </aside>
        )}
        <div
          ref={source}
          tabIndex={-1}
          hidden={!reading}
          className={cn(
            styles.source,
            "scroll-mt-36 overflow-hidden rounded-md border border-review-border focus-visible:outline-2 focus-visible:outline-review-link sm:scroll-mt-24",
          )}
          aria-label="Selected saved source"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-review-border bg-review-chrome px-4 py-3">
            <h2 className="min-w-0 break-words text-sm font-semibold text-review-link">
              {selectedGroup?.title ?? "All saved changes"}
            </h2>
            <span className="text-xs text-review-muted">
              {sourceOnly
                ? "Saved evidence · analysis not complete"
                : "Generated change brief · exact saved source"}
            </span>
            {selectedGroup && markControl(selectedGroup)}
          </div>
          {!sourceOnly && (
            <details
              className={cn(
                styles.mobileContext,
                "border-b border-review-border bg-review-chrome px-4 py-3 text-xs",
              )}
            >
              <summary className="cursor-pointer py-2">
                Purpose and source grounding
              </summary>
              <p className="mt-2 leading-6 text-review-muted">
                Generated interpretation, not verified author intent. Saved{" "}
                {review.headSha?.slice(0, 7) ?? "revision unavailable"}.
              </p>
              {selectedGroup ? (
                <>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-review-body">
                    {selectedGroup.purpose}
                  </p>
                  <div className="mt-3">
                    {selectedGroup.hunkIds.flatMap((id) => {
                      const hunk = byHunk.get(id);
                      return hunk ? [sourceLink(hunk, selectedGroup)] : [];
                    })}
                  </div>
                </>
              ) : (
                <p className="mt-3 leading-6 text-review-muted">
                  This source is outside a selected purpose section. All saved
                  changes and the ungrouped inventory remain reachable above.
                </p>
              )}
            </details>
          )}
          <ReviewDiffPanel
            review={review}
            files={files}
            findings={findings}
            allFindings={allFindings}
            verdicts={verdicts}
            activeFindingId={activeFindingId}
            focus={focus}
            hotspots={result?.hotspots ?? []}
            onSelectFinding={selectFinding}
            onNavigate={navigate}
            onReviewLatest={onRerun}
          />
        </div>
      </div>
      {result && !sourceOnly && (
        <div className="mt-6 space-y-4">
          <details className="review-reading-plane rounded-md p-4">
            <summary className="cursor-pointer py-2 text-sm font-medium">
              Findings · {allFindings.length} concerns to inspect
            </summary>
            <p className="mt-3 text-xs leading-5 text-review-muted">
              Open a concern at its exact source. Finding filters never remove
              files or hunks from All changes.
            </p>
            <div
              className="mt-3 flex flex-wrap gap-2"
              role="group"
              aria-label="Filter findings by severity"
            >
              {(["all", "high", "medium", "low"] as const).map((value) => (
                <Button
                  key={value}
                  size="sm"
                  variant={filter === value ? "secondary" : "outline"}
                  aria-pressed={filter === value}
                  className="h-auto min-h-8 max-w-full whitespace-normal"
                  onClick={() => setFilter(value)}
                >
                  {value === "all" ? "All severities" : `${value} severity`}
                </Button>
              ))}
            </div>
            {!allFindings.length ? (
              <p className="mt-4 text-sm leading-6 text-review-muted">
                No validated findings reported within this analysis’s coverage.
                This does not establish that the change is correct.
              </p>
            ) : !findings.length ? (
              <p className="mt-4 text-sm text-review-muted">
                No findings match this filter.
              </p>
            ) : (
              <>
                <ul className="mt-4 space-y-2">
                  {findings
                    .filter((finding) => !isNitpick(finding))
                    .map(findingEntry)}
                </ul>
                {findings.some(isNitpick) && (
                  <details className="mt-4">
                    <summary className="cursor-pointer py-2 text-xs">
                      Nitpicks and low-confidence notes ·{" "}
                      {findings.filter(isNitpick).length}
                    </summary>
                    <ul className="mt-3 space-y-2">
                      {findings.filter(isNitpick).map(findingEntry)}
                    </ul>
                  </details>
                )}
              </>
            )}
          </details>
          <details className="review-reading-plane rounded-md p-4">
            <summary className="cursor-pointer py-2 text-sm font-medium">
              Machine assessment, hotspots and coverage
            </summary>
            <div className="mt-4">
              <ReviewAssessment
                assessment={result.assessment}
                heading="Machine assessment"
                sourceOwner={review.sourceOwner ?? review.repoOwner}
                sourceRepo={review.sourceRepo ?? review.repoName}
              />
              <ReviewHotspots
                review={review}
                files={files}
                onSelect={navigate}
              />
              <p className="text-xs leading-6 text-review-muted">
                Static analysis received diffs for{" "}
                {result.coverage.diffFiles.length} of{" "}
                {result.coverage.changedFiles} changed files and read{" "}
                {result.coverage.filesRead.length} source files. This is machine
                coverage, not human reading.
              </p>
              {result.coverage.warnings.map((warning, index) => (
                <p
                  key={index}
                  className="mt-2 text-xs leading-6 text-review-muted"
                >
                  {warning}
                </p>
              ))}
              <p className="mt-3 text-xs leading-6 text-review-muted">
                The initial review is static inspection, not evidence that
                tests, builds, or browser flows passed. Investigation reports
                its own actual capabilities and recorded checks separately.
              </p>
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer py-2">
                  Source files inspected by the model
                </summary>
                <ul className="mt-2 space-y-1 break-all text-review-muted">
                  {result.coverage.filesRead.map((path) => (
                    <li key={path}>{path}</li>
                  ))}
                </ul>
              </details>
            </div>
          </details>
          {previous && (
            <details className="review-reading-plane rounded-md p-4">
              <summary className="cursor-pointer py-2 text-sm font-medium">
                Reassessment and prior review
              </summary>
              <div className="mt-4">
                <ReviewReassessment
                  review={review}
                  previous={previous}
                  files={files}
                  onOpenReview={onSelectReview}
                  onNavigate={navigate}
                />
                {!result.reassessment && previous.result && (
                  <p className="mt-3 text-xs leading-6 text-review-muted">
                    {
                      previous.result.findings.filter(
                        (prior) =>
                          !result.findings.some(
                            (current) => current.previousFindingId === prior.id,
                          ),
                      ).length
                    }{" "}
                    prior findings were not reported again. Absence does not
                    prove a fix; open the prior review for its saved evidence
                    and discussions.
                  </p>
                )}
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
