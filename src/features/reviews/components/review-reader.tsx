"use client";

import { Disclosure, DisclosureSummary } from "@/components/ui/disclosure";
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
import ChevronRight from "@boxicons/react/ChevronRight";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  navigationLocation,
  type ReviewFinding,
  type ReviewNavigationTarget,
} from "../lib/review-diff";
import { SeverityBadge } from "./severity-badge";
import { isNitpick, sortFindings } from "../lib/finding-presentation";
import type { FindingVerdict } from "./finding-verdict-badge";
import { ReviewNavigation } from "./review-navigation";
import { ReviewAssessment } from "./review-assessment";
import { ReviewHotspots } from "./review-hotspots";
import { ReviewActivityFeed } from "./review-activity-feed";
import { buildActivityRows } from "../lib/review-activity";
import { computeCoverage } from "../lib/review-coverage";
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

function lineSpan(start: number, lines: number) {
  if (lines <= 0) return "none";
  return lines === 1 ? `${start}` : `${start}–${start + lines - 1}`;
}

function counted(count: number, singular: string) {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

export interface ReviewReaderProps {
  review: Doc<"reviews">;
  files: Doc<"reviewFiles">[];
  verdicts?: Record<string, FindingVerdict>;
  previous: Doc<"reviews"> | null;
  initialFindingId: string | null;
  onRerun: () => void;
  onSelectReview: (id: Id<"reviews">, findingId?: string) => void;
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
  const ungroupedByFile = [...Map.groupBy(ungrouped, (hunk) => hunk.path)];
  const ungroupedRow = ([path, fileHunks]: [string, ChangeHunk[]]) => (
    <li key={path}>
      <button
        type="button"
        onClick={() => navigate({ kind: "hunk", hunk: fileHunks[0] })}
        className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm leading-5 text-review-body hover:bg-review-reading"
      >
        <span className="min-w-0 flex-1 break-all font-mono">{path}</span>
        <span className="shrink-0 text-review-muted">
          {counted(fileHunks.length, "block")}
        </span>
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-review-muted"
        />
      </button>
    </li>
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
  const activityRows = buildActivityRows(review);
  const coverage = computeCoverage(files, review.activity ?? []);
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

  function openNextUnread() {
    if (readIds === undefined) return;
    const next = groups.find((group) => !readIds.includes(group.id));
    if (!next) return;
    const first = next.hunkIds
      .map((id) => byHunk.get(id))
      .find((hunk): hunk is ChangeHunk => hunk !== undefined);
    if (first) navigate({ kind: "group", group: next, hunk: first });
    else setSelectedGroupId(next.id);
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
        error instanceof Error ? error.message : "Couldn’t reach the server",
      );
    } finally {
      setPendingMarks((current) => {
        const next = new Set(current);
        next.delete(group.id);
        return next;
      });
    }
  }

  function readCheckbox(group: ChangeGroup) {
    return (
      <label className="flex min-h-11 shrink-0 items-center gap-2 text-sm text-review-body">
        <input
          type="checkbox"
          className="size-5 accent-[var(--review-link)]"
          checked={readIds?.includes(group.id) ?? false}
          disabled={
            !review.headSha ||
            readIds === undefined ||
            pendingMarks.has(group.id)
          }
          onChange={() => void toggleRead(group)}
        />
        {readIds === undefined
          ? "Loading…"
          : pendingMarks.has(group.id)
            ? "Saving…"
            : "Read"}
        <span className="sr-only"> {group.title}</span>
      </label>
    );
  }

  function sourceLink(hunk: ChangeHunk, group: ChangeGroup) {
    return (
      <button
        key={hunk.id}
        type="button"
        onClick={() => navigate({ kind: "group", group, hunk })}
        className="block min-h-11 w-full rounded-md px-2 py-2 text-left text-sm leading-5 text-review-body hover:bg-review-reading hover:underline"
      >
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 break-all font-mono">
            {hunk.path}
          </span>
          <ChevronRight
            aria-hidden="true"
            className="size-4 shrink-0 text-review-muted"
          />
        </span>
        <span className="text-review-muted">
          Block {hunk.ordinal + 1} · before lines{" "}
          {lineSpan(hunk.leftStart, hunk.leftLines)} · after lines{" "}
          {lineSpan(hunk.rightStart, hunk.rightLines)}
        </span>
      </button>
    );
  }

  function groupRow(group: ChangeGroup, index: number, compact: boolean) {
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
      <li
        key={group.id}
        className={cn(
          "flex min-w-0 gap-3 border-t border-review-border px-4 py-3 first:border-t-0",
          selected && "bg-review-reading",
          compact ? "bg-review-chrome" : "review-reading-plane",
        )}
      >
        <span
          aria-hidden="true"
          className="w-5 shrink-0 pt-1 text-sm tabular-nums text-review-muted"
        >
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3">
            <h3 className="min-w-0 text-sm font-semibold leading-6">
              <button
                type="button"
                onClick={() =>
                  members[0]
                    ? navigate({ kind: "group", group, hunk: members[0] })
                    : setSelectedGroupId(group.id)
                }
                aria-current={selected ? "location" : undefined}
                className="min-h-11 text-left text-review-text"
              >
                {group.title}
                {selected && (
                  <span className="sr-only"> · selected section</span>
                )}
              </button>
            </h3>
            {!(compact && selected) && readCheckbox(group)}
          </div>
          <p className="text-sm text-review-muted">
            {counted(members.length, "block")}
          </p>
          {groupFindings[0] && (
            <button
              type="button"
              onClick={() => selectFinding(groupFindings[0].id)}
              className="mt-1 flex min-h-11 w-full items-center gap-2 rounded-md text-left text-sm text-review-text hover:underline"
            >
              <SeverityBadge severity={groupFindings[0].severity} />
              <span className="min-w-0 flex-1">{groupFindings[0].title}</span>
              {groupFindings.length > 1 && (
                <span className="shrink-0 text-review-muted">
                  +{groupFindings.length - 1} more
                </span>
              )}
            </button>
          )}
          {(!compact || selected) && (
            <>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-review-body">
                {group.purpose}
              </p>
              <Disclosure className="mt-2">
                <DisclosureSummary className="py-3 text-sm text-review-muted">
                  Show source for {counted(members.length, "block")}
                </DisclosureSummary>
                <div className="mt-1">
                  {members.map((hunk) => sourceLink(hunk, group))}
                </div>
                {members.length < group.hunkIds.length && (
                  <p className="mt-2 text-sm leading-5 text-review-muted">
                    {counted(
                      group.hunkIds.length - members.length,
                      "referenced block",
                    )}{" "}
                    unavailable in this saved inventory. No substitute source is
                    shown.
                  </p>
                )}
              </Disclosure>
            </>
          )}
        </div>
      </li>
    );
  }

  const view = inventoryOpen ? "all" : reading ? "source" : "brief";
  function showView(next: string) {
    if (next === "all") {
      if (!inventoryOpen) toggleInventory();
    } else if (next === "brief") returnToBrief();
    else {
      setInventoryOpen(false);
      setReading(true);
      requestAnimationFrame(() =>
        source.current?.focus({ preventScroll: true }),
      );
    }
  }
  const viewControl = (
    <div
      role="group"
      aria-label="View"
      className="inline-flex max-w-full overflow-hidden rounded-md border border-review-border"
    >
      {(
        [
          ...(sourceOnly ? [] : [["brief", "Brief"]]),
          ["source", "Source"],
          ["all", "All changes"],
        ] as [string, string][]
      ).map(([id, label], index) => (
        <button
          key={id}
          ref={id === "all" ? inventoryTrigger : undefined}
          type="button"
          aria-pressed={view === id}
          disabled={id === "source" && !reading && !focus}
          onClick={() => showView(id)}
          className={cn(
            "min-h-11 px-4 text-sm text-review-text hover:bg-review-reading disabled:text-review-muted",
            index > 0 && "border-l border-review-border",
            view === id && "bg-review-reading font-semibold",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );

  function findingEntry(finding: ReviewFinding) {
    return (
      <li key={finding.id}>
        <button
          type="button"
          onClick={() => selectFinding(finding.id)}
          className="flex min-h-11 w-full flex-col gap-1 rounded-md border border-review-border px-3 py-2 text-left text-sm hover:bg-review-reading"
        >
          <span className="flex items-baseline gap-2">
            <SeverityBadge severity={finding.severity} />
            <span className="text-review-text">{finding.title}</span>
          </span>
          <span className="break-all text-review-muted">
            {finding.path}:{finding.line} ({finding.side ?? "RIGHT"})
            {isNitpick(finding) && " · nitpick"}
            {verdicts[finding.id] === "incorrect" && " · retracted"}
          </span>
        </button>
      </li>
    );
  }

  const findingsSection = result && (
    <section aria-labelledby={`${readerId}-findings`} className="mt-4">
      <h3 id={`${readerId}-findings`} className="text-sm font-semibold">
        Findings · {counted(allFindings.length, "finding")}
      </h3>
      {!allFindings.length ? (
        <p className="mt-2 text-sm leading-6 text-review-body">
          No findings were reported for the files this review covered. That does
          not mean the change is correct; read the source yourself.
        </p>
      ) : (
        <>
          <div
            className="mt-2 flex flex-wrap gap-2"
            role="group"
            aria-label="Filter findings by severity"
          >
            {(["all", "high", "medium", "low"] as const).map((value) => (
              <Button
                key={value}
                size="sm"
                variant={filter === value ? "secondary" : "outline"}
                aria-pressed={filter === value}
                className="h-auto min-h-11 max-w-full whitespace-normal text-sm"
                onClick={() => setFilter(value)}
              >
                {value === "all" ? "All" : value}
              </Button>
            ))}
          </div>
          {!findings.length ? (
            <p className="mt-3 text-sm text-review-body">
              No findings at this severity. Choose All to see the rest.
            </p>
          ) : (
            <>
              <ul className="mt-3 space-y-2">
                {findings.slice(0, 3).map(findingEntry)}
              </ul>
              {findings.length > 3 && (
                <Disclosure className="mt-2">
                  <DisclosureSummary className="py-3 text-sm">
                    {counted(findings.length - 3, "more finding")}
                  </DisclosureSummary>
                  <ul className="space-y-2">
                    {findings.slice(3).map(findingEntry)}
                  </ul>
                </Disclosure>
              )}
            </>
          )}
        </>
      )}
    </section>
  );

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
          Your read mark was not saved. Try again, or reload the page if it
          keeps failing. ({markError})
        </p>
      )}
      <div className="mb-3">{viewControl}</div>
      {result && !sourceOnly && (
        <p className="mb-4 text-sm leading-6 text-review-muted">
          Generated interpretation, not verified author intent. Findings come
          from static review, not verified by execution.
        </p>
      )}
      {inventoryOpen && (
        <section
          id={`${readerId}-inventory`}
          className="review-reading-plane mb-5 rounded-md p-4"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2
              ref={inventory}
              tabIndex={-1}
              className="scroll-mt-36 text-sm font-semibold sm:scroll-mt-24"
            >
              All changed files
            </h2>
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
              reading ? "bg-review-chrome" : "review-reading-plane",
            )}
            aria-label={
              reading ? "Context spine" : "Purpose-based change brief"
            }
          >
            <div className="p-4 sm:p-5">
              {result &&
                !sourceOnly &&
                readIds !== undefined &&
                groups.length > 0 && (
                  <p
                    className="mb-4 text-sm font-medium text-review-text"
                    aria-live="polite"
                  >
                    {readCount < groups.length
                      ? `Your turn: ${counted(groups.length - readCount, "group")} unread.`
                      : "All groups read."}
                  </p>
                )}
              <h2
                ref={brief}
                tabIndex={-1}
                className={cn(
                  "scroll-mt-36 sm:scroll-mt-24",
                  reading ? "text-lg font-semibold leading-7" : "sr-only",
                )}
              >
                {reading ? "Change context" : "Summary"}
              </h2>
              {!reading && result && (
                <p className="max-w-[65ch] whitespace-pre-wrap text-sm leading-7 text-review-body">
                  {result.summary}
                </p>
              )}
              {findingsSection}
              {!groups.length && (
                <p className="mt-4 text-sm leading-6 text-review-body">
                  This review has no change groups, so there is nothing to mark
                  read. Open All changes to read the source file by file.
                </p>
              )}
              {groups.length > 0 && (
                <div className="mt-5 space-y-3">
                  {readIds === undefined ? (
                    <p className="text-sm text-review-muted">
                      Loading your read marks…
                    </p>
                  ) : (
                    <>
                      <div
                        role="progressbar"
                        aria-label="Groups read"
                        aria-valuemin={0}
                        aria-valuemax={groups.length}
                        aria-valuenow={readCount}
                        className="h-2 w-full overflow-hidden rounded-full bg-review-border"
                      >
                        <div
                          className="h-full bg-review-link"
                          style={{
                            width: `${(readCount / groups.length) * 100}%`,
                          }}
                        />
                      </div>
                      {readCount < groups.length ? (
                        <Button
                          className="h-auto min-h-11 w-full whitespace-normal text-sm sm:w-auto"
                          onClick={openNextUnread}
                        >
                          Next unread group
                        </Button>
                      ) : null}
                    </>
                  )}
                  <p className="text-sm leading-6 text-review-muted">
                    {hunks.length - ungrouped.length} of{" "}
                    {counted(hunks.length, "block")} sit in groups;{" "}
                    {ungrouped.length} ungrouped. A block is one contiguous edit
                    inside one file. Read marks are yours; they don’t approve
                    the PR.
                  </p>
                </div>
              )}
              <ol
                aria-label="Reading order"
                className="mt-3 overflow-hidden rounded-md border border-review-border"
              >
                {groups.map((group, index) => groupRow(group, index, reading))}
              </ol>
              {ungrouped.length > 0 && (
                <div className="mt-5">
                  <h3 className="py-2 text-sm font-semibold">
                    Ungrouped · {counted(ungroupedByFile.length, "file")}
                  </h3>
                  <ul className="space-y-1">
                    {ungroupedByFile.slice(0, 5).map(ungroupedRow)}
                  </ul>
                  {ungroupedByFile.length > 5 && (
                    <Disclosure className="mt-2">
                      <DisclosureSummary className="py-3 text-sm text-review-muted">
                        Show {counted(ungroupedByFile.length - 5, "more file")}
                      </DisclosureSummary>
                      <ul className="mt-1 space-y-1">
                        {ungroupedByFile.slice(5).map(ungroupedRow)}
                      </ul>
                    </Disclosure>
                  )}
                </div>
              )}
              {(gaps.length > 0 || missingFiles > 0 || !files.length) && (
                <p className="mt-3 text-sm leading-6 text-review-body">
                  Some of this PR’s files were not saved with this review:{" "}
                  {missingFiles > 0 &&
                    `${counted(missingFiles, "changed file")} absent; `}
                  {gaps.length > 0 &&
                    `${counted(gaps.length, "file coverage gap")}; `}
                  {!files.length && "no file inventory was saved; "}
                  open All changes to see what is available, and check the rest
                  on GitHub.
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
            "scroll-mt-36 overflow-hidden rounded-md border border-review-border sm:scroll-mt-24",
          )}
          aria-label="Selected saved source"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-review-border bg-review-chrome px-4 py-3">
            <h2 className="min-w-0 break-words text-sm font-semibold text-review-text">
              {selectedGroup?.title ?? "All saved changes"}
            </h2>
            <span className="text-sm text-review-muted">
              {sourceOnly
                ? "Saved evidence · analysis not complete"
                : "Exact saved source"}
            </span>
            {selectedGroup && readCheckbox(selectedGroup)}
          </div>
          {!sourceOnly && (
            <Disclosure
              className={cn(
                styles.mobileContext,
                "border-b border-review-border bg-review-chrome px-4 py-3 text-sm",
              )}
            >
              <DisclosureSummary className="py-3">
                Purpose and source grounding
              </DisclosureSummary>
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
                  This source is not part of a group. Find it under Ungrouped in
                  the Brief, or in All changes.
                </p>
              )}
            </Disclosure>
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
          <Disclosure className="review-reading-plane rounded-md p-4">
            <DisclosureSummary className="py-3 text-sm font-medium">
              Automated review and coverage details
            </DisclosureSummary>
            <div className="mt-4">
              <ReviewAssessment
                assessment={result.assessment}
                heading="Automated assessment"
                sourceOwner={review.sourceOwner ?? review.repoOwner}
                sourceRepo={review.sourceRepo ?? review.repoName}
              />
              <ReviewHotspots
                review={review}
                files={files}
                onSelect={navigate}
              />
              <p className="text-sm leading-6 text-review-muted">
                Static analysis received diffs for{" "}
                {result.coverage.diffFiles.length} of{" "}
                {result.coverage.changedFiles} changed files and read{" "}
                {result.coverage.filesRead.length} source files. This is machine
                coverage, not human reading.
              </p>
              {result.coverage.warnings.map((warning, index) => (
                <p
                  key={index}
                  className="mt-2 text-sm leading-6 text-review-muted"
                >
                  {warning}
                </p>
              ))}
              <p className="mt-3 text-sm leading-6 text-review-muted">
                Investigation reports its own capabilities and recorded checks
                separately.
              </p>
              {coverage.total > 0 && (
                <p className="mt-3 text-sm leading-6 text-review-muted">
                  The reviewer opened {coverage.read} of {coverage.total}{" "}
                  changed lines.
                  {coverage.unread.length > 0 &&
                    ` Never opened: ${coverage.unread.join(", ")}.`}
                </p>
              )}
              {activityRows.some((row) => row.kind === "tool") && (
                <ReviewActivityFeed
                  rows={activityRows}
                  live={false}
                  collapsed
                  startedAt={review._creationTime}
                  onOpen={(target) =>
                    files.some((file) => file.filename === target.path) &&
                    review.headSha
                      ? navigate({
                          kind: "reference",
                          reference: {
                            path: target.path,
                            sourcePath: target.path,
                            line: target.start ?? 1,
                            side: "RIGHT",
                            commitSha: review.headSha,
                          },
                        })
                      : undefined
                  }
                />
              )}
              <Disclosure className="mt-3 text-sm">
                <DisclosureSummary className="py-3">
                  Source files inspected by the model
                </DisclosureSummary>
                <ul className="mt-2 space-y-1 break-all text-review-muted">
                  {result.coverage.filesRead.map((path) => (
                    <li key={path}>{path}</li>
                  ))}
                </ul>
              </Disclosure>
            </div>
          </Disclosure>
          {previous && (
            <Disclosure className="review-reading-plane rounded-md p-4">
              <DisclosureSummary className="py-3 text-sm font-medium">
                Reassessment and prior review
              </DisclosureSummary>
              <div className="mt-4">
                <ReviewReassessment
                  review={review}
                  previous={previous}
                  files={files}
                  onOpenReview={onSelectReview}
                  onNavigate={navigate}
                />
                {!result.reassessment && previous.result && (
                  <p className="mt-3 text-sm leading-6 text-review-muted">
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
            </Disclosure>
          )}
        </div>
      )}
    </section>
  );
}
