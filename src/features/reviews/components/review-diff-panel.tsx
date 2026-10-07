"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CodeViewItem } from "@pierre/diffs";
import {
  CodeView,
  type CodeViewHandle,
  type CodeViewReactOptions,
} from "@pierre/diffs/react";
import { ChevronRight } from "lucide-react";
import type { Doc } from "../../../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import {
  buildDiffItems,
  diffItemId,
  navigationLocation,
  parseSavedDiffs,
  type ReviewFinding as Finding,
  type ReviewAnnotation,
  type ReviewNavigationTarget,
} from "../lib/review-diff";
import type { Hotspot } from "../../../../convex/lib/review_navigation";
import { SeverityBadge } from "./severity-badge";
import {
  FindingVerdictBadge,
  type FindingVerdict,
} from "./finding-verdict-badge";

// The app's light and dark palettes are both dark, so the diff stays dark too.
const OPTIONS: CodeViewReactOptions<ReviewAnnotation, undefined> = {
  theme: "pierre-dark",
  diffStyle: "unified",
  stickyHeaders: true,
  layout: { paddingTop: 0, paddingBottom: 16, gap: 12 },
};

export default function ReviewDiffPanel({
  files,
  findings,
  verdicts,
  activeFindingId,
  focus,
  onSelectFinding,
  hotspots,
  onSelectHotspot,
  allFindings,
}: {
  files: Doc<"reviewFiles">[];
  findings: Finding[];
  verdicts?: Record<string, FindingVerdict>;
  activeFindingId: string | null;
  /** A new object scrolls its finding into view, even if it was already active. */
  focus: ReviewNavigationTarget | null;
  hotspots: Hotspot[];
  allFindings: Finding[];
  onSelectHotspot: (
    target: Extract<ReviewNavigationTarget, { kind: "hotspot" }>,
  ) => void;
  onSelectFinding: (id: string) => void;
}) {
  const viewer = useRef<CodeViewHandle<ReviewAnnotation, undefined>>(null);
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const [suppressedFocus, setSuppressedFocus] = useState<typeof focus>(null);
  const forcedPath =
    focus && focus !== suppressedFocus
      ? navigationLocation(focus).path
      : undefined;
  const diffs = useMemo(() => parseSavedDiffs(files), [files]);
  const items = useMemo(
    () =>
      buildDiffItems(
        diffs,
        findings,
        toggled,
        hotspots,
        forcedPath,
        allFindings,
      ),
    [diffs, findings, toggled, hotspots, forcedPath, allFindings],
  );
  const omittedReasons = useMemo(
    () => new Map(files.map((file) => [file.filename, file.omittedReason])),
    [files],
  );
  const withoutDiff = useMemo(
    () => files.filter((file) => !file.patch).map((file) => file.filename),
    [files],
  );

  useEffect(() => {
    if (
      !focus ||
      !viewer.current ||
      !diffs.some((diff) => diff.path === navigationLocation(focus).path)
    )
      return;
    const location = navigationLocation(focus);
    const id = diffItemId(location.path);
    if (location.line === undefined) {
      viewer.current.scrollTo({
        type: "item",
        id,
        align: "start",
        behavior: "instant",
      });
      return;
    }
    const { line, side } = location;
    const diffSide = side === "LEFT" ? "deletions" : "additions";
    viewer.current.setSelectedLines({
      id,
      range: { start: line, end: line, side: diffSide },
    });
    viewer.current.scrollTo({
      type: "line",
      id,
      lineNumber: line,
      side: diffSide,
      align: "center",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, [focus, diffs]);

  const renderAnnotation = useCallback(
    ({ metadata }: { metadata: ReviewAnnotation }) => {
      if (metadata.kind === "hotspot")
        return (
          <button
            type="button"
            onClick={() => onSelectHotspot(metadata)}
            className="m-2 rounded border bg-sidebar p-3 text-left font-sans text-sm focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span className="block font-medium">
              {metadata.hotspot.kind === "human_judgment"
                ? "Human judgment"
                : "Possible issue"}
              : {metadata.hotspot.title}
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {metadata.hotspot.reason}
            </span>
          </button>
        );
      const f = metadata.finding;
      return (
        <button
          type="button"
          onClick={() => onSelectFinding(f.id)}
          aria-pressed={f.id === activeFindingId}
          className={cn(
            "my-1.5 mr-4 ml-3 block max-w-2xl rounded-lg border bg-sidebar px-3 py-2.5 text-left font-sans transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
            f.id === activeFindingId && "border-ring",
          )}
        >
          <span className="flex items-center gap-2">
            <SeverityBadge severity={f.severity} />
            <FindingVerdictBadge verdict={verdicts?.[f.id]} />
            <span className="text-sm font-medium text-foreground">
              {f.title}
            </span>
          </span>
          <span className="mt-1.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
            {f.explanation}
          </span>
        </button>
      );
    },
    [activeFindingId, onSelectFinding, onSelectHotspot, verdicts],
  );

  const renderHeaderMetadata = useCallback(
    (item: CodeViewItem<ReviewAnnotation>) => {
      if (item.type !== "diff") return null;
      const path = item.fileDiff.name;
      const count = item.annotations?.length ?? 0;
      const omitted = omittedReasons.get(path);
      return (
        <span className="flex items-center gap-3 font-sans text-xs text-muted-foreground">
          {omitted && (
            <span
              title={`The reviewer could locate changed lines but did not receive this diff (${omitted}).`}
              className="shrink-0 whitespace-nowrap"
            >
              Not sent
            </span>
          )}
          {count > 0 && (
            <span>
              {count} {count === 1 ? "annotation" : "annotations"}
            </span>
          )}
          <button
            type="button"
            aria-expanded={!item.collapsed}
            aria-label={`${item.collapsed ? "Show" : "Hide"} diff for ${path}`}
            onClick={() => {
              setSuppressedFocus(focus);
              setToggled((current) => {
                const next = new Set(current);
                if (!next.delete(path)) next.add(path);
                return next;
              });
            }}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ChevronRight
              className={cn("size-3", !item.collapsed && "rotate-90")}
            />
            {item.collapsed ? "Show" : "Hide"}
          </button>
        </span>
      );
    },
    [omittedReasons, focus],
  );

  const renderFooter = useCallback(
    () =>
      withoutDiff.length > 0 && (
        <details className="mx-1 rounded-lg border p-4 font-sans text-sm text-muted-foreground">
          <summary className="cursor-pointer">
            {withoutDiff.length} changed{" "}
            {withoutDiff.length === 1 ? "file has" : "files have"} no text diff
          </summary>
          <ul className="mt-3 font-mono text-xs leading-6 break-all">
            {withoutDiff.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        </details>
      ),
    [withoutDiff],
  );

  return (
    <CodeView<ReviewAnnotation, undefined>
      ref={viewer}
      items={items}
      options={OPTIONS}
      renderAnnotation={renderAnnotation}
      renderHeaderMetadata={renderHeaderMetadata}
      renderCodeViewFooter={renderFooter}
      className="h-full overflow-auto"
    />
  );
}
