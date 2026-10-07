import { cn } from "@/lib/utils";

export type FindingVerdict =
  "supported" | "incorrect" | "could-not-reproduce" | "inconclusive";

const LABELS: Record<FindingVerdict, string> = {
  supported: "Confirmed",
  incorrect: "Retracted (incorrect)",
  "could-not-reproduce": "Could not reproduce",
  inconclusive: "Inconclusive",
};

export function FindingVerdictBadge({ verdict }: { verdict?: FindingVerdict }) {
  if (!verdict) return null;
  return (
    <span
      className={cn(
        "shrink-0 rounded px-2 py-1 text-xs font-medium",
        verdict === "supported"
          ? "bg-emerald-400/10 text-emerald-300"
          : verdict === "incorrect"
            ? "bg-zinc-400/10 text-zinc-300"
            : "bg-zinc-400/10 text-muted-foreground",
      )}
    >
      {LABELS[verdict]}
    </span>
  );
}
