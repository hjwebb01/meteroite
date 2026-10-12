import { cn } from "@/lib/utils";

export type FindingVerdict =
  "supported" | "incorrect" | "could-not-reproduce" | "inconclusive";

export const FINDING_VERDICT_LABELS: Record<
  FindingVerdict,
  { badge: string; compact: string }
> = {
  supported: { badge: "Confirmed", compact: "confirmed" },
  incorrect: { badge: "Retracted (incorrect)", compact: "retracted" },
  "could-not-reproduce": {
    badge: "Could not reproduce",
    compact: "not reproduced",
  },
  inconclusive: { badge: "Inconclusive", compact: "inconclusive" },
};

export function FindingVerdictBadge({ verdict }: { verdict?: FindingVerdict }) {
  if (!verdict) return null;
  return (
    <span
      className={cn(
        "shrink-0 rounded px-2 py-1 text-xs font-medium",
        verdict === "supported"
          ? "bg-verdict-confirmed/10 text-verdict-confirmed"
          : verdict === "incorrect"
            ? "bg-review-border text-review-body"
            : "bg-review-border text-muted-foreground",
      )}
    >
      {FINDING_VERDICT_LABELS[verdict].badge}
    </span>
  );
}
