import { useId } from "react";
import { cn } from "@/lib/utils";

/** The name with its streak: a trail that burns hotter toward the stone. */
export function Wordmark({ className }: { className?: string }) {
  const id = useId();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-serif text-[19px] leading-none tracking-[-0.015em] text-review-text",
        className,
      )}
    >
      <svg aria-hidden viewBox="0 0 20 20" className="size-[18px] shrink-0">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop
              offset="0"
              style={{ stopColor: "var(--sev-high)", stopOpacity: 0 }}
            />
            <stop offset="1" style={{ stopColor: "var(--sev-high)" }} />
          </linearGradient>
        </defs>
        <path
          d="M2 3 L13.5 14.5"
          stroke={`url(#${id})`}
          strokeWidth={2}
          strokeLinecap="round"
        />
        <circle
          cx="15"
          cy="16"
          r="2.75"
          style={{ fill: "var(--review-text)" }}
        />
      </svg>
      Meteroite
    </span>
  );
}
