"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import type { CodeViewItem } from "@pierre/diffs";
import {
  CodeView,
  type CodeViewHandle,
  type CodeViewReactOptions,
} from "@pierre/diffs/react";
import Check from "@boxicons/react/Check";
import ChevronDown from "@boxicons/react/ChevronDown";
import ChevronUp from "@boxicons/react/ChevronUp";
import type { Doc } from "../../../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import {
  annotationKey,
  buildDiffItems,
  diffItemId,
  navigationLocation,
  parseSavedDiffs,
  type ReviewFinding as Finding,
  type ReviewAnnotation,
  type ReviewNavigationTarget,
} from "../lib/review-diff";
import type { Hotspot } from "../../../../convex/lib/review_navigation";
import type { FindingVerdict } from "./finding-verdict-badge";

// Annotations render as zero-height anchors; finding cards live in the margin
// column and are positioned against them (DESIGN.md, "Margin findings").
// The viewer renders in shadow DOM and has no per-line decoration API, so a
// flagged line is styled by finding its annotation slot, whose name encodes
// the side and line number.
const BASE_CSS = `
  [data-line-annotation] { min-height: 0 !important; background: transparent !important; }
  [data-annotation-content] { padding: 0 !important; margin: 0 !important; }
  [data-line][data-selected-line] { background-image: linear-gradient(rgb(255 255 255 / 7%), rgb(255 255 255 / 7%)); }
  [data-diffs-header] { background: #15171c; }
`;

type FlagTone = "judgment" | "low" | "medium" | "high";
// Ascending: when two marks share a line the later rule wins.
const FLAG_ORDER: FlagTone[] = ["judgment", "low", "medium", "high"];
const FLAG_COLORS: Record<FlagTone, { bar: string; tint: string }> = {
  high: { bar: "#ffb380", tint: "rgb(255 159 90 / 12%)" },
  medium: { bar: "#e8c46a", tint: "rgb(232 196 106 / 10%)" },
  low: { bar: "#8a90a0", tint: "rgb(138 144 160 / 9%)" },
  judgment: { bar: "#8fb4ff", tint: "rgb(143 180 255 / 9%)" },
};

function flaggedLineCss(
  marks: { side: "additions" | "deletions"; line: number; tone: FlagTone }[],
) {
  return FLAG_ORDER.flatMap((tone) =>
    marks
      .filter((mark) => mark.tone === tone)
      .map(
        ({ side, line }) =>
          `[data-line]:has(+ [data-line-annotation] slot[name="annotation-${side}-${line}"]) { box-shadow: inset 3px 0 0 ${FLAG_COLORS[tone].bar}; background-color: ${FLAG_COLORS[tone].tint}; }`,
      ),
  ).join("\n");
}

const BASE_OPTIONS: CodeViewReactOptions<ReviewAnnotation, undefined> = {
  theme: "pierre-dark",
  diffStyle: "unified",
  stickyHeaders: true,
  overflow: "wrap",
  layout: { paddingTop: 0, paddingBottom: 16, gap: 8 },
};

const LINE_HEIGHT = 20;
/** Roughly one file header; the header counts as reached this close to the top. */
const HEADER_REACH = 40;
const MARGIN_WIDTH = 420;
const MARGIN_MIN_WIDTH = 1000;
const CARD_GAP = 8;

type Tone = "high" | "medium" | "low" | "judgment" | "resolved";
const TONE_TEXT: Record<Tone, string> = {
  high: "text-sev-high",
  medium: "text-sev-medium",
  low: "text-review-muted",
  judgment: "text-sev-judgment",
  resolved: "text-review-dim",
};
const TONE_BORDER: Record<Tone, string> = {
  high: "border-sev-high",
  medium: "border-sev-medium",
  low: "border-review-border-strong",
  judgment: "border-sev-judgment border-dashed",
  resolved: "border-transparent",
};
const TONE_STROKE: Record<Tone, string> = {
  high: "var(--sev-high)",
  medium: "var(--sev-medium)",
  low: "var(--review-text-muted)",
  judgment: "var(--sev-judgment)",
  resolved: "var(--review-text-dim)",
};
const SEVERITY_LABEL = { high: "HIGH", medium: "MED", low: "LOW" } as const;
const VERDICT_LABEL: Record<FindingVerdict, string> = {
  supported: "confirmed",
  incorrect: "retracted",
  "could-not-reproduce": "not reproduced",
  inconclusive: "inconclusive",
};

type Placement = { top: number; lineY: number };
type Hint = { above: number; aboveKey?: string; below: number; belowKey?: string };

const pathOf = (metadata: ReviewAnnotation) =>
  metadata.kind === "finding" ? metadata.finding.path : metadata.reference.path;

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
  resolved,
  onResolve,
  onOpenFinding,
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
  onSelectFinding: (id: string | null) => void;
  /** Findings the reviewer dismissed in this session. */
  resolved: ReadonlySet<string>;
  onResolve: (id: string, resolved: boolean) => void;
  /** Opens the proposal and discussion panel for a finding. */
  onOpenFinding: (id: string) => void;
}) {
  const viewer = useRef<CodeViewHandle<ReviewAnnotation, undefined>>(null);
  const container = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const margin = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  const focused = useRef<typeof focus>(null);
  const visible = useRef(true);
  const entries = useRef<ReviewAnnotation[]>([]);
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const [suppressedFocus, setSuppressedFocus] = useState<typeof focus>(null);
  const [wide, setWide] = useState(true);
  const [placements, setPlacements] = useState<Map<string, Placement>>(
    () => new Map(),
  );
  const [hint, setHint] = useState<Hint>({ above: 0, below: 0 });
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const currentRef = useRef<string | null>(null);
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
  const isResolved = useCallback(
    (f: Finding) => resolved.has(f.id) || verdicts?.[f.id] === "incorrect",
    [resolved, verdicts],
  );
  // Diff order, then line order: the order findings are walked with J/K.
  const ordered = useMemo(() => {
    const index = new Map(diffs.map((diff, i) => [diff.path, i]));
    return findings
      .filter((f) => index.has(f.path))
      .sort(
        (a, b) =>
          index.get(a.path)! - index.get(b.path)! || a.line - b.line,
      );
  }, [diffs, findings]);
  const open = ordered.filter((f) => !isResolved(f));
  const options = useMemo(() => {
    const marks = [
      ...ordered
        .filter((f) => !isResolved(f))
        .map((f) => ({
          side: f.side === "LEFT" ? ("deletions" as const) : ("additions" as const),
          line: f.line,
          tone: f.severity as FlagTone,
        })),
      ...hotspots.flatMap((h) =>
        h.references.map((r) => ({
          side: r.side === "LEFT" ? ("deletions" as const) : ("additions" as const),
          line: r.line,
          tone: "judgment" as const,
        })),
      ),
    ];
    return {
      ...BASE_OPTIONS,
      unsafeCSS: BASE_CSS + flaggedLineCss(marks),
    };
  }, [ordered, hotspots, isResolved]);
  const activeKey = focus ? annotationKey(focus) : undefined;
  const marginEntries = items.flatMap((item) =>
    (item.annotations ?? []).map((annotation) => annotation.metadata),
  );
  const entryByKey = new Map(
    marginEntries.map((metadata) => [annotationKey(metadata)!, metadata]),
  );
  useLayoutEffect(() => {
    entries.current = marginEntries;
  });

  const step = useCallback(
    (direction: 1 | -1) => {
      if (open.length === 0) return;
      const current = open.findIndex((f) => f.id === activeFindingId);
      const next =
        current === -1
          ? direction === 1
            ? 0
            : open.length - 1
          : (current + direction + open.length) % open.length;
      onSelectFinding(open[next].id);
    },
    [open, activeFindingId, onSelectFinding],
  );

  // Dismissing moves on to the next open finding so triage can keep flowing.
  const dismiss = useCallback(
    (id: string) => {
      const index = open.findIndex((f) => f.id === id);
      const rest = open.filter((f) => f.id !== id);
      const next = rest.length > 0 ? rest[index % rest.length] : undefined;
      onResolve(id, true);
      onSelectFinding(next?.id ?? null);
    },
    [open, onResolve, onSelectFinding],
  );

  // J and K walk findings only while this panel is on screen.
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => {
      visible.current = entry.isIntersecting;
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!visible.current) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest("input, textarea, select, [contenteditable='true']")
      )
        return;
      if (event.key === "j" || event.key === "k") {
        event.preventDefault();
        step(event.key === "j" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setWide(entry.contentRect.width >= MARGIN_MIN_WIDTH),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Positions cards against their anchors, pushing later cards down on overlap
  // and sliding the last ones up to stay on screen. It also finds the file at
  // the top of the viewer and counts findings outside the visible range.
  // Anchors outside the viewer's rendered window have no position, so their
  // cards stay hidden and they are counted in the hints instead. The current
  // file follows scrolling only: a file picked from the tabs stays current
  // even when the viewer cannot scroll far enough to bring its header up.
  const measure = useCallback((scrolled = false) => {
    const root = container.current;
    const column = margin.current;
    if (!root || !column) return;
    const origin = column.getBoundingClientRect().top;
    const height = column.clientHeight;
    const anchors = [
      ...root.querySelectorAll<HTMLElement>("[data-review-anchor]"),
    ]
      .map((anchor) => ({
        key: anchor.dataset.reviewAnchor!,
        lineY: anchor.getBoundingClientRect().top - origin - LINE_HEIGHT / 2,
      }))
      .sort((a, b) => a.lineY - b.lineY);
    const heightOf = (key: string) => cards.current.get(key)?.offsetHeight ?? 36;
    const tops: number[] = [];
    let floor = -Infinity;
    for (const { key, lineY } of anchors) {
      const top = Math.max(lineY - 14, floor);
      tops.push(top);
      floor = top + heightOf(key) + CARD_GAP;
    }
    let ceiling = height - CARD_GAP;
    for (let i = anchors.length - 1; i >= 0; i--) {
      if (anchors[i].lineY > height) continue;
      tops[i] = Math.max(0, Math.min(tops[i], ceiling - heightOf(anchors[i].key)));
      ceiling = tops[i] - CARD_GAP;
    }
    const next = new Map<string, Placement>();
    anchors.forEach(({ key, lineY }, i) => next.set(key, { top: tops[i], lineY }));

    // A file header that has reached the top of the viewer (within a header's
    // height, since headers stick there) makes its file current. Before any
    // header gets there, the first file is current.
    const edge = (scroller.current ?? root).getBoundingClientRect().top;
    const headers = [
      ...root.querySelectorAll<HTMLElement>("[data-review-file]"),
    ];
    const passed = headers.filter(
      (header) => header.getBoundingClientRect().top <= edge + HEADER_REACH,
    );
    const path =
      (passed.length > 0 ? passed[passed.length - 1] : headers[0])?.dataset
        .reviewFile ?? null;

    const isVisible = (key: string) => {
      const place = next.get(key);
      return place !== undefined && place.lineY >= 0 && place.lineY <= height;
    };
    const keys = entries.current.map((metadata) => annotationKey(metadata)!);
    // Entries are in line order, so the first one at or below the top edge
    // splits the list: everything before it is above the viewer.
    let pivot = keys.findIndex((key) => (next.get(key)?.lineY ?? -1) >= 0);
    if (pivot === -1) {
      const lastPlaced = keys.reduce(
        (last, key, i) => (next.has(key) ? i : last),
        -1,
      );
      pivot =
        lastPlaced !== -1
          ? lastPlaced + 1
          : Math.max(0, entries.current.findIndex((m) => pathOf(m) === path));
    }
    const later = keys.slice(pivot).filter((key) => !isVisible(key));
    const nextHint: Hint = {
      above: pivot,
      aboveKey: pivot > 0 ? keys[pivot - 1] : undefined,
      below: later.length,
      belowKey: later[0],
    };

    setPlacements((current) =>
      samePlacements(current, next) ? current : next,
    );
    setHint((current) => (sameHint(current, nextHint) ? current : nextHint));
    if (path && (scrolled || !currentRef.current)) {
      currentRef.current = path;
      setCurrentPath(path);
    }
  }, []);

  // Scroll updates land in the same frame as the scroll, so cards never trail
  // the code they belong to.
  const onScroll = useCallback(() => flushSync(() => measure(true)), [measure]);

  const frame = useRef(0);
  const layout = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => measure());
  }, [measure]);

  useLayoutEffect(() => {
    if (!wide) return;
    layout();
    const observer = new ResizeObserver(layout);
    for (const card of cards.current.values()) observer.observe(card);
    if (container.current) observer.observe(container.current);
    // The viewer mounts annotation anchors after React commits.
    const mutations = new MutationObserver(layout);
    if (container.current)
      mutations.observe(container.current, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      mutations.disconnect();
    };
  });

  useEffect(() => {
    if (!focus) viewer.current?.clearSelectedLines();
    if (
      !focus ||
      !viewer.current ||
      !diffs.some((diff) => diff.path === navigationLocation(focus).path)
    )
      return;
    const location = navigationLocation(focus);
    const id = diffItemId(location.path);
    // Keyboard focus follows navigation into the code. The viewer renders
    // items lazily, so the target may only exist a few frames after scrolling.
    const key = annotationKey(focus);
    const selector = key
      ? `[data-review-annotation="${CSS.escape(key)}"]`
      : `[data-review-file="${CSS.escape(location.path)}"]`;
    let frameId = 0;
    let attempts = 0;
    // Only a new target moves focus; reloaded diffs must not pull it back.
    const moveFocus = () => {
      if (focused.current === focus) return;
      const target = container.current?.querySelector<HTMLElement>(selector);
      if (target?.checkVisibility({ visibilityProperty: true })) {
        focused.current = focus;
        target.focus({ preventScroll: true });
      } else if (attempts++ < 60) frameId = requestAnimationFrame(moveFocus);
    };
    const cancelFocus = () => cancelAnimationFrame(frameId);
    if (location.line === undefined) {
      viewer.current.scrollTo({
        type: "item",
        id,
        align: "start",
        behavior: "instant",
      });
      frameId = requestAnimationFrame(moveFocus);
      return cancelFocus;
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
    frameId = requestAnimationFrame(moveFocus);
    return cancelFocus;
  }, [focus, diffs]);

  const jumpTo = (key: string) => {
    const metadata = entryByKey.get(key);
    if (!metadata) return;
    if (metadata.kind === "hotspot") onSelectHotspot(metadata);
    else onSelectFinding(metadata.finding.id);
  };

  const renderCard = (metadata: ReviewAnnotation, inline: boolean) => {
    const key = annotationKey(metadata)!;
    const register = (node: HTMLElement | null) => {
      if (inline) return;
      if (node) cards.current.set(key, node);
      else cards.current.delete(key);
    };
    if (metadata.kind === "hotspot") {
      const expanded = key === activeKey;
      return (
        <MarginCard
          key={key}
          ref={register}
          tone="judgment"
          expanded={expanded}
          dataKey={key}
          label={`JUDGMENT L${metadata.reference.line}`}
          title={metadata.hotspot.title}
          onToggle={() =>
            expanded ? onSelectFinding(null) : onSelectHotspot(metadata)
          }
        >
          <Explanation text={metadata.hotspot.reason} />
        </MarginCard>
      );
    }
    const f = metadata.finding;
    const verdict = verdicts?.[f.id];
    if (isResolved(f))
      return (
        <div
          key={key}
          ref={register}
          data-review-annotation={key}
          tabIndex={-1}
          className="flex items-center gap-2 rounded-md px-3 py-1.5 text-[12.5px] text-review-muted"
        >
          <Check
            aria-hidden
            width={16}
            height={16}
            className="shrink-0 text-sev-resolved"
          />
          <span className="font-mono text-[11px] text-review-dim">
            L{f.line}
          </span>
          <span className="min-w-0 flex-1 truncate line-through">
            <InlineCode text={f.title} />
          </span>
          {resolved.has(f.id) ? (
            <button
              type="button"
              onClick={() => onResolve(f.id, false)}
              className="shrink-0 rounded text-review-link hover:underline focus-visible:outline-2 focus-visible:outline-review-link"
            >
              Reopen
            </button>
          ) : (
            <span className="shrink-0 text-review-dim">Retracted</span>
          )}
        </div>
      );
    const expanded = f.id === activeFindingId;
    const tone: Tone = f.severity;
    return (
      <MarginCard
        key={key}
        ref={register}
        tone={tone}
        expanded={expanded}
        dataKey={key}
        label={`${SEVERITY_LABEL[f.severity]} L${f.line}`}
        verdict={verdict}
        title={f.title}
        onToggle={() => onSelectFinding(expanded ? null : f.id)}
      >
        <Explanation text={f.explanation} />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onOpenFinding(f.id)}
            className="h-8 rounded-md border border-review-border-strong px-3 text-[12.5px] font-medium text-review-text hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-review-link"
          >
            Propose fix &amp; discuss
          </button>
          <button
            type="button"
            onClick={() => dismiss(f.id)}
            className="h-8 rounded-md px-2 text-[12.5px] text-review-link hover:underline focus-visible:outline-2 focus-visible:outline-review-link"
          >
            Dismiss
          </button>
        </div>
      </MarginCard>
    );
  };

  const renderAnnotation = (
    { metadata }: { metadata: ReviewAnnotation },
    _item: CodeViewItem<ReviewAnnotation>,
  ) => {
    const key = annotationKey(metadata)!;
    if (!wide)
      return <div className="px-3 py-1.5 font-ui">{renderCard(metadata, true)}</div>;
    return <div data-review-anchor={key} />;
  };

  // The file bar is ours, so the path appears once here and the file's own
  // name is not repeated. Collapsed files are an outlined row, not a filled bar.
  const renderCustomHeader = (item: CodeViewItem<ReviewAnnotation>) => {
    if (item.type !== "diff") return null;
    const path = item.fileDiff.name;
    const slash = path.lastIndexOf("/");
    let additions = 0;
    let deletions = 0;
    for (const hunk of item.fileDiff.hunks) {
      additions += hunk.additionLines;
      deletions += hunk.deletionLines;
    }
    const count = item.annotations?.length ?? 0;
    const omitted = omittedReasons.get(path);
    const quiet = count === 0 && !omitted;
    return (
      <div
        className={cn(
          "flex min-h-9 items-center gap-3 px-3 py-1.5 font-ui text-[12.5px]",
          item.collapsed
            ? "rounded-md border border-review-border"
            : "rounded-t-md border border-b-0 border-review-border bg-review-file-header",
        )}
      >
        <span className="min-w-0 flex-1 font-mono [overflow-wrap:anywhere]">
          {slash !== -1 && (
            <span className="text-review-dim">{path.slice(0, slash + 1)}</span>
          )}
          <span className="text-review-text">{path.slice(slash + 1)}</span>
        </span>
        {omitted && (
          <span
            title={`The reviewer could locate changed lines but did not receive this diff (${omitted}).`}
            className="shrink-0 whitespace-nowrap text-review-muted"
          >
            Not sent · {omitted}
          </span>
        )}
        {quiet && item.collapsed && (
          <span className="hidden shrink-0 font-serif text-[14px] italic text-review-muted sm:inline">
            Read in full — nothing to note.
          </span>
        )}
        <span className="shrink-0 font-mono text-[12px] text-review-muted">
          <span className="text-diff-add">+{additions}</span>{" "}
          <span className="text-diff-del">−{deletions}</span>
        </span>
        <button
          type="button"
          data-review-file={path}
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
          className="shrink-0 rounded px-1.5 py-0.5 text-review-link hover:underline focus-visible:outline-2 focus-visible:outline-review-link"
        >
          {item.collapsed ? "Show diff" : "Hide"}
        </button>
      </div>
    );
  };

  const renderFooter = () =>
    withoutDiff.length > 0 && (
      <details className="mx-1 rounded-md border border-review-border p-4 font-ui text-[13px] text-review-muted">
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
    );

  const resolvedCount = ordered.length - open.length;

  return (
    <div
      ref={container}
      className="flex h-full flex-col bg-review-bg font-ui text-review-text"
    >
      <div className="flex items-stretch gap-4 border-b border-review-border bg-review-chrome pr-3">
        <FileTabs
          diffs={diffs}
          findings={ordered}
          hotspots={hotspots}
          isResolved={isResolved}
          current={currentPath}
          onSelect={(path) => {
            currentRef.current = path;
            setCurrentPath(path);
            viewer.current?.scrollTo({
              type: "item",
              id: diffItemId(path),
              align: "start",
              behavior: "instant",
            });
          }}
        />
        <div className="flex shrink-0 items-center gap-2 py-2">
          <span className="mr-1 text-xs whitespace-nowrap text-review-muted">
            {open.length} open · {resolvedCount} resolved
          </span>
          <IconButton label="Previous finding (K)" onClick={() => step(-1)}>
            <ChevronUp aria-hidden width={18} height={18} />
          </IconButton>
          <IconButton label="Next finding (J)" onClick={() => step(1)}>
            <ChevronDown aria-hidden width={18} height={18} />
          </IconButton>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1">
        <CodeView<ReviewAnnotation, undefined>
          ref={viewer}
          containerRef={scroller}
          items={items}
          options={options}
          onScroll={onScroll}
          renderAnnotation={renderAnnotation}
          renderCustomHeader={renderCustomHeader}
          renderCodeViewFooter={renderFooter}
          className="h-full min-w-0 flex-1 overflow-auto"
        />
        {wide && (
          <div
            ref={margin}
            aria-label="Findings"
            role="region"
            onWheel={(event) =>
              scroller.current?.scrollBy({ top: event.deltaY })
            }
            style={{ width: MARGIN_WIDTH }}
            className="relative shrink-0 overflow-hidden border-l border-review-border"
          >
            <svg
              aria-hidden
              className="pointer-events-none absolute inset-0 h-full w-full"
            >
              {marginEntries.map((metadata) => {
                const key = annotationKey(metadata)!;
                const place = placements.get(key);
                if (!place) return null;
                const tone: Tone =
                  metadata.kind === "hotspot"
                    ? "judgment"
                    : isResolved(metadata.finding)
                      ? "resolved"
                      : metadata.finding.severity;
                const cardY = place.top + 16;
                return (
                  <path
                    key={key}
                    d={`M0 ${place.lineY} H8 V${cardY} H16`}
                    fill="none"
                    stroke={TONE_STROKE[tone]}
                    strokeWidth={1}
                    strokeDasharray={tone === "resolved" ? "1 3" : "3 3"}
                  />
                );
              })}
            </svg>
            {marginEntries.map((metadata) => {
              const key = annotationKey(metadata)!;
              const place = placements.get(key);
              return (
                <div
                  key={key}
                  className="absolute right-3 left-4"
                  style={{
                    top: place?.top ?? 0,
                    visibility: place ? "visible" : "hidden",
                  }}
                >
                  {renderCard(metadata, false)}
                </div>
              );
            })}
            {hint.above > 0 && (
              <OffscreenHint
                direction="above"
                count={hint.above}
                onClick={() => hint.aboveKey && jumpTo(hint.aboveKey)}
              />
            )}
            {hint.below > 0 && (
              <OffscreenHint
                direction="below"
                count={hint.below}
                onClick={() => hint.belowKey && jumpTo(hint.belowKey)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function OffscreenHint({
  direction,
  count,
  onClick,
}: {
  direction: "above" | "below";
  count: number;
  onClick: () => void;
}) {
  const Icon = direction === "above" ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "absolute left-1/2 z-10 flex h-7 -translate-x-1/2 items-center gap-1.5 rounded-full border border-review-border-strong bg-review-chrome px-3 text-[12px] text-review-muted shadow-lg shadow-black/30 hover:text-review-text focus-visible:outline-2 focus-visible:outline-review-link",
        direction === "above" ? "top-2" : "bottom-2",
      )}
    >
      <Icon aria-hidden width={14} height={14} />
      {count} {direction}
    </button>
  );
}

function MarginCard({
  ref,
  tone,
  expanded,
  dataKey,
  label,
  verdict,
  title,
  onToggle,
  children,
}: {
  ref: (node: HTMLElement | null) => void;
  tone: Tone;
  expanded: boolean;
  dataKey: string;
  label: string;
  verdict?: FindingVerdict;
  title: string;
  onToggle: () => void;
  children: ReactNode;
}) {
  if (!expanded)
    return (
      <button
        ref={ref}
        type="button"
        data-review-annotation={dataKey}
        aria-expanded={false}
        onClick={onToggle}
        className={cn(
          "flex w-full items-center gap-2 rounded-md border bg-review-bg px-3 py-1.5 text-left text-[13px] hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-review-link",
          tone === "judgment"
            ? TONE_BORDER.judgment
            : "border-review-border-strong",
        )}
      >
        <span
          className={cn(
            "shrink-0 font-mono text-[11px] font-semibold",
            TONE_TEXT[tone],
          )}
        >
          {label}
        </span>
        <span className="min-w-0 truncate text-review-text">
          <InlineCode text={title} />
        </span>
      </button>
    );
  return (
    <section
      ref={ref}
      data-review-annotation={dataKey}
      tabIndex={-1}
      aria-label={title}
      className={cn(
        "rounded-md border px-3 py-2.5 shadow-lg shadow-black/30 focus-visible:outline-2 focus-visible:outline-review-link",
        TONE_BORDER[tone],
        tone === "high" ? "bg-sev-high-bg" : "bg-review-chrome",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "font-mono text-[11px] font-semibold",
            TONE_TEXT[tone],
          )}
        >
          {label}
        </span>
        {verdict && (
          <span
            className={cn(
              "text-[11.5px]",
              verdict === "supported"
                ? "text-verdict-confirmed"
                : "text-review-muted",
            )}
          >
            {VERDICT_LABEL[verdict]}
          </span>
        )}
        <button
          type="button"
          aria-expanded={true}
          aria-label="Collapse finding"
          onClick={onToggle}
          className="ml-auto grid size-7 place-items-center rounded text-review-muted hover:bg-white/5 hover:text-review-text focus-visible:outline-2 focus-visible:outline-review-link"
        >
          <ChevronUp aria-hidden width={16} height={16} />
        </button>
      </div>
      <h3 className="mt-1 mb-2 font-serif text-[19px] leading-tight font-medium text-review-text">
        <InlineCode text={title} />
      </h3>
      {children}
    </section>
  );
}

function FileTabs({
  diffs,
  findings,
  hotspots,
  isResolved,
  current,
  onSelect,
}: {
  diffs: ReturnType<typeof parseSavedDiffs>;
  findings: Finding[];
  hotspots: Hotspot[];
  isResolved: (f: Finding) => boolean;
  current: string | null;
  onSelect: (path: string) => void;
}) {
  const baseNames = diffs.map(({ path }) => path.split("/").pop()!);
  return (
    <nav
      aria-label="Changed files"
      className="flex min-w-0 flex-1 overflow-x-auto"
    >
      {diffs.map(({ path, fileDiff }, index) => {
        const length = Math.max(
          1,
          ...fileDiff.hunks.map((h) => h.additionStart + h.additionCount),
        );
        const marks = findings.filter((f) => f.path === path);
        const judgments = hotspots.flatMap((h) =>
          h.references.filter((r) => r.path === path),
        );
        const open = marks.filter((f) => !isResolved(f));
        const worst: Tone | undefined = open.some((f) => f.severity === "high")
          ? "high"
          : open.some((f) => f.severity === "medium")
            ? "medium"
            : open.length > 0
              ? "low"
              : judgments.length > 0
                ? "judgment"
                : undefined;
        const active = path === current;
        // Two files with the same basename show their parent directory too.
        const base = baseNames[index];
        const ambiguous = baseNames.filter((name) => name === base).length > 1;
        const name = ambiguous ? path.split("/").slice(-2).join("/") : base;
        const underline =
          worst === "high"
            ? "border-sev-high"
            : worst === "medium"
              ? "border-sev-medium"
              : worst === "judgment"
                ? "border-sev-judgment"
                : "border-review-muted";
        return (
          <button
            key={path}
            type="button"
            title={path}
            aria-current={active ? "location" : undefined}
            onClick={() => onSelect(path)}
            className={cn(
              "relative flex shrink-0 flex-col gap-1.5 border-b-2 px-3 pt-2.5 pb-2 text-left font-mono text-[12.5px] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-review-link",
              active
                ? cn("text-review-text", underline)
                : "border-transparent text-review-muted hover:text-review-text",
            )}
          >
            <span className="flex items-center gap-1.5">
              {name}
              {!worst && (
                <Check
                  aria-label="No findings"
                  width={14}
                  height={14}
                  className="text-sev-resolved"
                />
              )}
            </span>
            <span className="relative block h-1.5 w-full min-w-16 rounded-sm bg-review-border">
              {marks.map((f) => (
                <span
                  key={f.id}
                  className={cn(
                    "absolute top-0 h-full w-[3px] rounded-sm",
                    isResolved(f)
                      ? "bg-review-dim"
                      : f.severity === "high"
                        ? "bg-sev-high"
                        : f.severity === "medium"
                          ? "bg-sev-medium"
                          : "bg-review-muted",
                  )}
                  style={{ left: `${Math.min(96, (f.line / length) * 100)}%` }}
                />
              ))}
              {judgments.map((r) => (
                <span
                  key={`${r.line}:${r.side}`}
                  className="absolute top-0 h-full w-[3px] rounded-sm bg-sev-judgment"
                  style={{ left: `${Math.min(96, (r.line / length) * 100)}%` }}
                />
              ))}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

/** Renders `backtick` spans as code, since findings are written in Markdown. */
function InlineCode({ text }: { text: string }) {
  return text.split(/(`[^`]+`)/).map((part, i) =>
    part.length > 2 && part.startsWith("`") && part.endsWith("`") ? (
      <code
        key={i}
        className="rounded bg-white/8 px-1 py-px font-mono text-[0.82em] font-normal text-review-text"
      >
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );
}

const CLAMP_LINES = 5;

function Explanation({ text }: { text: string }) {
  const body = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const node = body.current;
    if (node && !open) setClamped(node.scrollHeight > node.clientHeight + 1);
  }, [text, open]);
  return (
    <div>
      <p
        ref={body}
        className="text-[13.5px] leading-5 text-review-body"
        style={
          open
            ? undefined
            : {
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: CLAMP_LINES,
                overflow: "hidden",
              }
        }
      >
        <InlineCode text={text} />
      </p>
      {(clamped || open) && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="mt-1 rounded text-[12.5px] text-review-link hover:underline focus-visible:outline-2 focus-visible:outline-review-link"
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-md border border-review-border-strong text-review-text hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-review-link"
    >
      {children}
    </button>
  );
}

function samePlacements(a: Map<string, Placement>, b: Map<string, Placement>) {
  if (a.size !== b.size) return false;
  for (const [key, value] of b) {
    const other = a.get(key);
    if (
      !other ||
      Math.abs(other.top - value.top) > 0.5 ||
      Math.abs(other.lineY - value.lineY) > 0.5
    )
      return false;
  }
  return true;
}

function sameHint(a: Hint, b: Hint) {
  return (
    a.above === b.above &&
    a.aboveKey === b.aboveKey &&
    a.below === b.below &&
    a.belowKey === b.belowKey
  );
}
