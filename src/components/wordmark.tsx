import { cn } from "@/lib/utils";

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-[1.125rem] font-medium leading-none tracking-[-0.03em] text-review-text",
        className,
      )}
    >
      <svg aria-hidden viewBox="0 0 16 16" className="size-4 shrink-0">
        <path d="M5 0H16V16H0V5Z" style={{ fill: "var(--review-link)" }} />
      </svg>
      meteroite
    </span>
  );
}
