import {
  memo,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Check from "@boxicons/react/Check";
import ChevronDown from "@boxicons/react/ChevronDown";
import ChevronUp from "@boxicons/react/ChevronUp";
import { cn } from "@/lib/utils";
import type { Hotspot } from "../../../../convex/lib/review_navigation";
import {
  parseSavedDiffs,
  type ReviewFinding as Finding,
} from "../lib/review-diff";
import {
  FINDING_VERDICT_LABELS,
  type FindingVerdict,
} from "./finding-verdict-badge";
import { Button } from "@/components/ui/button";

export type Tone = "high" | "medium" | "low" | "judgment" | "resolved";
const TONE_TEXT: Record<Tone, string> = {
  high: "text-sev-high",
  medium: "text-sev-medium",
  low: "text-sev-low",
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
export const TONE_STROKE: Record<Tone, string> = {
  high: "var(--sev-high)",
  medium: "var(--sev-medium)",
  low: "var(--sev-low)",
  judgment: "var(--sev-judgment)",
  resolved: "var(--review-text-dim)",
};
export const SEVERITY_LABEL = {
  high: "HIGH",
  medium: "MED",
  low: "LOW",
} as const;
const TONE_WORD: Record<Tone, string> = {
  high: "high severity",
  medium: "medium severity",
  low: "low severity",
  judgment: "judgment needed",
  resolved: "resolved",
};
// Tab underline and mark colors. Low-severity tabs keep a muted underline.
const TAB_UNDERLINE: Record<Tone, string> = {
  high: "border-sev-high",
  medium: "border-sev-medium",
  low: "border-review-muted",
  judgment: "border-sev-judgment",
  resolved: "border-review-muted",
};
const TAB_MARK: Record<Tone, string> = {
  high: "bg-sev-high shadow-[0_0_6px_var(--sev-high)]",
  medium: "bg-sev-medium",
  low: "bg-sev-low",
  judgment: "bg-sev-judgment",
  resolved: "bg-review-dim",
};
export function OffscreenHint({
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
      {count} {count === 1 ? "finding" : "findings"} {direction}
    </button>
  );
}

export function MarginCard({
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
          "flex w-full items-baseline gap-2 rounded-md border bg-review-bg px-3 py-1.5 text-left hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-review-link",
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
        <span className="line-clamp-2 min-w-0 font-serif text-[14px] leading-snug text-review-text">
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
          className={cn("font-mono text-[11px] font-semibold", TONE_TEXT[tone])}
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
            {FINDING_VERDICT_LABELS[verdict].compact}
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
      <h3 className="mt-1 mb-2 font-serif text-[19px] leading-tight tracking-[-0.01em] text-review-text">
        <InlineCode text={title} />
      </h3>
      {children}
    </section>
  );
}

export const FileTabs = memo(function FileTabs({
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
  const baseNameCounts = new Map<string, number>();
  for (const name of baseNames)
    baseNameCounts.set(name, (baseNameCounts.get(name) ?? 0) + 1);
  const findingsByPath = new Map<string, Finding[]>();
  for (const finding of findings) {
    const pathFindings = findingsByPath.get(finding.path) ?? [];
    pathFindings.push(finding);
    findingsByPath.set(finding.path, pathFindings);
  }
  const judgmentsByPath = new Map<string, Hotspot["references"]>();
  for (const hotspot of hotspots)
    for (const reference of hotspot.references) {
      const pathReferences = judgmentsByPath.get(reference.path) ?? [];
      pathReferences.push(reference);
      judgmentsByPath.set(reference.path, pathReferences);
    }
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
        const marks = findingsByPath.get(path) ?? [];
        const judgments = judgmentsByPath.get(path) ?? [];
        const open = marks.filter((f) => !isResolved(f));
        // Worst open severity wins; judgment-only files are "judgment".
        const worst: Tone | undefined =
          (["high", "medium", "low"] as const).find((severity) =>
            open.some((f) => f.severity === severity),
          ) ?? (judgments.length > 0 ? "judgment" : undefined);
        const active = path === current;
        // Two files with the same basename show their parent directory too.
        const base = baseNames[index];
        const ambiguous = (baseNameCounts.get(base) ?? 0) > 1;
        const name = ambiguous ? path.split("/").slice(-2).join("/") : base;
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
                ? cn("text-review-text", TAB_UNDERLINE[worst ?? "low"])
                : "border-transparent text-review-muted hover:text-review-text",
            )}
          >
            <span className="flex items-center gap-1.5">
              {name}
              {!worst && (
                <Check
                  aria-hidden
                  width={14}
                  height={14}
                  className="text-sev-resolved"
                />
              )}
            </span>
            <span className="sr-only">
              {[
                open.length > 0 &&
                  `${open.length} open, ${TONE_WORD[worst ?? "low"]}`,
                judgments.length > 0 && `${judgments.length} for judgment`,
                marks.length > open.length &&
                  `${marks.length - open.length} resolved`,
              ]
                .filter(Boolean)
                .join(", ") || "No findings"}
            </span>
            <span className="relative block h-1.5 w-full min-w-16 rounded-sm bg-review-border">
              {marks.map((f) => (
                <span
                  key={f.id}
                  className={cn(
                    "absolute top-0 h-full w-[3px] rounded-sm",
                    TAB_MARK[isResolved(f) ? "resolved" : f.severity],
                  )}
                  style={{ left: `${Math.min(96, (f.line / length) * 100)}%` }}
                />
              ))}
              {judgments.map((r) => (
                <span
                  key={`${r.line}:${r.side}`}
                  className={cn(
                    "absolute top-0 h-full w-[3px] rounded-sm",
                    TAB_MARK.judgment,
                  )}
                  style={{ left: `${Math.min(96, (r.line / length) * 100)}%` }}
                />
              ))}
            </span>
          </button>
        );
      })}
    </nav>
  );
});

/** Renders `backtick` spans as code, since findings are written in Markdown. */
export function InlineCode({ text }: { text: string }) {
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

export function Explanation({ text }: { text: string }) {
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

export function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="text-review-text hover:bg-white/5"
    >
      {children}
    </Button>
  );
}
