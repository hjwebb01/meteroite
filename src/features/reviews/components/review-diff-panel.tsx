"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
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
import { Button } from "@/components/ui/button";
import type { Doc } from "../../../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import {
  annotationKey,
  buildDiffItems,
  calculateMarginLayout,
  diffItemId,
  diffSideOf,
  navigationLocation,
  parseSavedDiffs,
  type ReviewFinding as Finding,
  type ReviewAnnotation,
  type ReviewNavigationTarget,
} from "../lib/review-diff";
import type { Hotspot } from "../../../../convex/lib/review_navigation";
import type { FindingVerdict } from "./finding-verdict-badge";
import {
  Explanation,
  FileTabs,
  IconButton,
  InlineCode,
  MarginCard,
  OffscreenHint,
  SEVERITY_LABEL,
  TONE_STROKE,
  type Tone,
} from "./review-diff-parts";

// Annotations render as zero-height anchors; finding cards live in the margin
// column and are positioned against them (DESIGN.md, "Margin findings").
// The viewer renders in shadow DOM and has no per-line decoration API, so a
// flagged line is styled by finding its annotation slot, whose name encodes
// the side and line number. The viewer's own variables are pointed at the app
// palette so the code sits on the same ground as everything around it.
const BASE_CSS = `
  :host {
    --diffs-dark-bg: var(--review-code) !important;
    --diffs-dark: var(--review-text) !important;
    --diffs-addition-color: var(--diff-add-fg);
    --diffs-deletion-color: var(--diff-del-fg);
    --diffs-modified-color: var(--review-text);
    --diffs-bg-addition-override: color-mix(in oklab, var(--review-code) 92%, var(--diff-add-fg));
    --diffs-bg-deletion-override: color-mix(in oklab, var(--review-code) 90%, var(--diff-del-fg));
    --diffs-font-family: var(--font-code-face), monospace;
    --diffs-header-font-family: var(--font-ui-face), sans-serif;
    --diffs-font-size: 12.5px;
  }
  [data-line-annotation] { min-height: 0 !important; background: transparent !important; }
  [data-annotation-content] { padding: 0 !important; margin: 0 !important; }
  [data-line][data-selected-line] { background-image: linear-gradient(rgb(242 233 219 / 6%), rgb(242 233 219 / 6%)); }
  [data-diffs-header] { background: var(--review-code); }
`;

type FlagTone = Exclude<Tone, "resolved">;
// Ascending: when two marks share a line the later rule wins.
const FLAG_ORDER: FlagTone[] = ["judgment", "low", "medium", "high"];

// A flagged line is scorched: a bar in its severity color, a faint tint, and
// heat that builds toward the margin, where its streak continues to the card.
function flaggedLineCss(
  marks: { side: "additions" | "deletions"; line: number; tone: FlagTone }[],
) {
  return FLAG_ORDER.flatMap((tone) => {
    const color = TONE_STROKE[tone];
    const tint = (percent: number) =>
      `color-mix(in oklab, ${color} ${percent}%, transparent)`;
    return marks
      .filter((mark) => mark.tone === tone)
      .map(
        ({ side, line }) =>
          `[data-line]:has(+ [data-line-annotation] slot[name="annotation-${side}-${line}"]) { box-shadow: inset 3px 0 0 ${color}; background-image: linear-gradient(90deg, ${tint(13)}, ${tint(9)} 55%, ${tint(26)}); }`,
      );
  }).join("\n");
}

const BASE_OPTIONS: CodeViewReactOptions<ReviewAnnotation, undefined> = {
  theme: "pierre-dark",
  diffStyle: "unified",
  stickyHeaders: true,
  overflow: "wrap",
  layout: { paddingTop: 0, paddingBottom: 16, gap: 8 },
};

const LINE_HEIGHT = 20;
const MARGIN_WIDTH = 420;
const MARGIN_MIN_WIDTH = 1000;

type Placement = { top: number; lineY: number };
type Hint = {
  above: number;
  aboveKey?: string;
  below: number;
  belowKey?: string;
};

const IGNORE_CARD_REF = (_node: HTMLElement | null) => {};

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
  /** Opens the proposal and discussion panel for a finding. */
  onOpenFinding: (id: string) => void;
}) {
  const viewer = useRef<CodeViewHandle<ReviewAnnotation, undefined>>(null);
  const container = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const margin = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  const cardObserver = useRef<ResizeObserver | null>(null);
  const focused = useRef<typeof focus>(null);
  const visible = useRef(true);
  const entries = useRef<ReviewAnnotation[]>([]);
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  // Dismissals are local to this session until triage is persisted.
  const [resolved, setResolved] = useState<ReadonlySet<string>>(new Set());
  const [suppressedFocus, setSuppressedFocus] = useState<typeof focus>(null);
  const [wide, setWide] = useState(true);
  const [placements, setPlacements] = useState<Map<string, Placement>>(
    () => new Map(),
  );
  const [hint, setHint] = useState<Hint>({ above: 0, below: 0 });
  // The finding dismissed last, which cools to ash once as it settles.
  const [cooling, setCooling] = useState<string | null>(null);
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
        (a, b) => index.get(a.path)! - index.get(b.path)! || a.line - b.line,
      );
  }, [diffs, findings]);
  const open = useMemo(
    () => ordered.filter((f) => !isResolved(f)),
    [ordered, isResolved],
  );
  const options = useMemo(() => {
    const marks = [
      ...open.map((f) => ({
        side: diffSideOf(f.side),
        line: f.line,
        tone: f.severity as FlagTone,
      })),
      ...hotspots.flatMap((h) =>
        h.references.map((r) => ({
          side: diffSideOf(r.side),
          line: r.line,
          tone: "judgment" as const,
        })),
      ),
    ];
    return {
      ...BASE_OPTIONS,
      unsafeCSS: BASE_CSS + flaggedLineCss(marks),
    };
  }, [open, hotspots]);
  const activeKey = focus ? annotationKey(focus) : undefined;
  const marginEntries = useMemo(
    () =>
      items.flatMap((item) =>
        (item.annotations ?? []).map((annotation) => annotation.metadata),
      ),
    [items],
  );
  const entryByKey = useMemo(
    () =>
      new Map(
        marginEntries.map((metadata) => [annotationKey(metadata), metadata]),
      ),
    [marginEntries],
  );
  const cardRefs = useMemo(
    () =>
      new Map(
        marginEntries.map((metadata) => {
          const key = annotationKey(metadata);
          return [
            key,
            (node: HTMLElement | null) => {
              const previous = cards.current.get(key);
              if (previous) cardObserver.current?.unobserve(previous);
              if (node) {
                cards.current.set(key, node);
                cardObserver.current?.observe(node);
              } else {
                cards.current.delete(key);
              }
            },
          ] as const;
        }),
      ),
    [marginEntries],
  );
  useLayoutEffect(() => {
    entries.current = marginEntries;
  }, [marginEntries]);

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

  const resolve = useCallback(
    (id: string, value: boolean) => {
      setResolved((current) => {
        const next = new Set(current);
        if (value) next.add(id);
        else next.delete(id);
        return next;
      });
    },
    [setResolved],
  );

  // Dismissing moves on to the next open finding so triage can keep flowing.
  const dismiss = useCallback(
    (id: string) => {
      const index = open.findIndex((f) => f.id === id);
      const rest = open.filter((f) => f.id !== id);
      const next = rest.length > 0 ? rest[index % rest.length] : undefined;
      setCooling(id);
      resolve(id, true);
      onSelectFinding(next?.id ?? null);
    },
    [open, resolve, onSelectFinding, setCooling],
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
      if (target?.closest("input, textarea, select, [contenteditable='true']"))
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
    ].map((anchor) => ({
      key: anchor.dataset.reviewAnchor!,
      lineY: anchor.getBoundingClientRect().top - origin - LINE_HEIGHT / 2,
      height:
        cards.current.get(anchor.dataset.reviewAnchor!)?.offsetHeight ?? 36,
    }));
    const edge = (scroller.current ?? root).getBoundingClientRect().top;
    const headers = [
      ...root.querySelectorAll<HTMLElement>("[data-review-file]"),
    ];
    const {
      placements: next,
      hint: nextHint,
      path,
    } = calculateMarginLayout({
      anchors,
      height,
      headers: headers.map((header) => ({
        path: header.dataset.reviewFile!,
        top: header.getBoundingClientRect().top - edge,
      })),
      entries: entries.current,
    });

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
    cardObserver.current = observer;
    for (const card of cards.current.values()) observer.observe(card);
    if (container.current) observer.observe(container.current);
    // The viewer mounts annotation anchors after React commits.
    const mutations = new MutationObserver(layout);
    if (container.current)
      mutations.observe(container.current, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (cardObserver.current === observer) cardObserver.current = null;
      mutations.disconnect();
    };
  }, [wide, layout]);

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
    const diffSide = diffSideOf(side);
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
    const key = annotationKey(metadata);
    const register = inline ? IGNORE_CARD_REF : cardRefs.get(key)!;
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
          style={{ "--heat": TONE_STROKE[f.severity] } as CSSProperties}
          className={cn(
            "flex items-center gap-2 rounded-md px-3 py-1.5 text-[12.5px] text-review-muted",
            f.id === cooling && "cooling",
          )}
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
              onClick={() => resolve(f.id, false)}
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenFinding(f.id)}
            className="text-[12.5px] text-review-text hover:bg-white/5"
          >
            Propose fix &amp; discuss
          </Button>
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={() => dismiss(f.id)}
            className="px-2 text-[12.5px] text-review-link"
          >
            Dismiss
          </Button>
        </div>
      </MarginCard>
    );
  };

  const renderAnnotation = (
    { metadata }: { metadata: ReviewAnnotation },
    _item: CodeViewItem<ReviewAnnotation>,
  ) => {
    const key = annotationKey(metadata);
    if (!wide)
      return (
        <div className="px-3 py-1.5 font-ui">{renderCard(metadata, true)}</div>
      );
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
            : "rounded-t-md border border-review-border bg-review-file-header",
        )}
      >
        <span className="min-w-0 flex-1 font-mono [overflow-wrap:anywhere]">
          {slash !== -1 && (
            <span className="text-review-muted">
              {path.slice(0, slash + 1)}
            </span>
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
          <span className="hidden shrink-0 font-serif text-[14px] text-review-muted sm:inline">
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
  const selectPath = useCallback(
    (path: string) => {
      currentRef.current = path;
      setCurrentPath(path);
      viewer.current?.scrollTo({
        type: "item",
        id: diffItemId(path),
        align: "start",
        behavior: "instant",
      });
    },
    [setCurrentPath],
  );

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
          onSelect={selectPath}
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
              {/* Streaks burn brightest where they leave the line. */}
              <defs>
                {(["high", "medium", "low", "judgment"] as const).map(
                  (tone) => (
                    <linearGradient
                      key={tone}
                      id={`streak-${tone}`}
                      gradientUnits="userSpaceOnUse"
                      x1={0}
                      x2={16}
                    >
                      <stop
                        offset="0"
                        style={{ stopColor: TONE_STROKE[tone] }}
                      />
                      <stop
                        offset="1"
                        style={{
                          stopColor: TONE_STROKE[tone],
                          stopOpacity: 0.3,
                        }}
                      />
                    </linearGradient>
                  ),
                )}
              </defs>
              {marginEntries.map((metadata) => {
                const key = annotationKey(metadata);
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
                    stroke={
                      tone === "resolved"
                        ? TONE_STROKE.resolved
                        : `url(#streak-${tone})`
                    }
                    strokeWidth={tone === "resolved" ? 1 : 1.5}
                    strokeLinecap="round"
                    strokeDasharray={
                      tone === "resolved"
                        ? "1 3"
                        : tone === "judgment"
                          ? "3 3"
                          : undefined
                    }
                  />
                );
              })}
            </svg>
            {marginEntries.map((metadata) => {
              const key = annotationKey(metadata);
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
