import { cn } from "@/lib/utils";

export function SeverityBadge({
  severity,
}: {
  severity: "high" | "medium" | "low";
}) {
  return (
    <span
      className={cn(
        "shrink-0 rounded px-2 py-1 font-mono text-[11px] font-semibold uppercase",
        severity === "high"
          ? "bg-sev-high/10 text-sev-high"
          : severity === "medium"
            ? "bg-sev-medium/10 text-sev-medium"
            : "bg-review-link/10 text-review-link",
      )}
    >
      {severity}
    </span>
  );
}
