import { cn } from "@/lib/utils";

export function SeverityBadge({
  severity,
}: {
  severity: "high" | "medium" | "low";
}) {
  return (
    <span
      className={cn(
        "shrink-0 text-xs font-medium",
        severity === "high"
          ? "text-sev-high"
          : severity === "medium"
            ? "text-sev-medium"
            : "text-sev-low",
      )}
    >
      {severity[0].toUpperCase() + severity.slice(1)}
    </span>
  );
}
