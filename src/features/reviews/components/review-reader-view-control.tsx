import type { RefObject } from "react";
import { cn } from "@/lib/utils";

export type ReaderView = "brief" | "source" | "all";

export function ReaderViewControl({
  view,
  briefAvailable,
  sourceDisabled,
  allRef,
  onSelect,
}: {
  view: ReaderView;
  briefAvailable: boolean;
  sourceDisabled: boolean;
  allRef: RefObject<HTMLButtonElement | null>;
  onSelect: (view: ReaderView) => void;
}) {
  const options: { id: ReaderView; label: string }[] = [
    ...(briefAvailable ? [{ id: "brief" as const, label: "Brief" }] : []),
    { id: "source", label: "Source" },
    { id: "all", label: "All changes" },
  ];
  return (
    <div
      role="group"
      aria-label="View"
      className="inline-flex max-w-full overflow-hidden rounded-md border border-review-border"
    >
      {options.map(({ id, label }, index) => (
        <button
          key={id}
          ref={id === "all" ? allRef : undefined}
          type="button"
          aria-pressed={view === id}
          disabled={id === "source" && sourceDisabled}
          onClick={() => onSelect(id)}
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
}
