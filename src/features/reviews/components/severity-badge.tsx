import { cn } from "@/lib/utils";

export function SeverityBadge({
  severity,
}: {
  severity: "high" | "medium" | "low";
}) {
  return (
    <span
      className={cn(
        "shrink-0 rounded px-2 py-1 text-xs font-medium capitalize",
        severity === "high"
          ? "bg-red-400/10 text-red-300"
          : severity === "medium"
            ? "bg-amber-400/10 text-amber-300"
            : "bg-blue-400/10 text-blue-300",
      )}
    >
      {severity}
    </span>
  );
}
