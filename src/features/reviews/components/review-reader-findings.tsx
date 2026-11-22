import { Button } from "@/components/ui/button";
import { Disclosure, DisclosureSummary } from "@/components/ui/disclosure";
import type { ReviewFinding } from "../lib/review-diff";
import { isNitpick } from "../lib/finding-presentation";
import type { FindingVerdict } from "./finding-verdict-badge";
import { SeverityBadge } from "./severity-badge";
import { counted } from "./review-reader-text";

export type SeverityFilter = "all" | "high" | "medium" | "low";

export function FindingsSummary({
  headingId,
  allFindings,
  findings,
  filter,
  onFilter,
  verdicts,
  onSelect,
}: {
  headingId: string;
  allFindings: ReviewFinding[];
  findings: ReviewFinding[];
  filter: SeverityFilter;
  onFilter: (filter: SeverityFilter) => void;
  verdicts: Record<string, FindingVerdict>;
  onSelect: (id: string) => void;
}) {
  function findingEntry(finding: ReviewFinding) {
    return (
      <li key={finding.id}>
        <button
          type="button"
          onClick={() => onSelect(finding.id)}
          className="flex min-h-11 w-full flex-col gap-1 rounded-md border border-review-border px-3 py-2 text-left text-sm hover:bg-review-reading"
        >
          <span className="flex items-baseline gap-2">
            <SeverityBadge severity={finding.severity} />
            <span className="text-review-text">{finding.title}</span>
          </span>
          <span className="break-all text-review-muted">
            {finding.path}:{finding.line} ({finding.side ?? "RIGHT"})
            {isNitpick(finding) && " · nitpick"}
            {verdicts[finding.id] === "incorrect" && " · retracted"}
          </span>
        </button>
      </li>
    );
  }

  return (
    <section aria-labelledby={headingId} className="mt-4">
      <h3 id={headingId} className="text-sm font-semibold">
        Findings · {counted(allFindings.length, "finding")}
      </h3>
      {!allFindings.length ? (
        <p className="mt-2 text-sm leading-6 text-review-body">
          No findings were reported for the files this review covered. That does
          not mean the change is correct; read the source yourself.
        </p>
      ) : (
        <>
          {(allFindings.length > 1 || filter !== "all") && (
            <div
              className="mt-2 flex flex-wrap gap-2"
              role="group"
              aria-label="Filter findings by severity"
            >
              {(["all", "high", "medium", "low"] as const).map((value) => (
                <Button
                  key={value}
                  size="sm"
                  variant={filter === value ? "secondary" : "outline"}
                  aria-pressed={filter === value}
                  className="h-auto min-h-11 max-w-full whitespace-normal text-sm"
                  onClick={() => onFilter(value)}
                >
                  {value === "all" ? "All" : value}
                </Button>
              ))}
            </div>
          )}
          {!findings.length ? (
            <p className="mt-3 text-sm text-review-body">
              No findings at this severity. Choose All to see the rest.
            </p>
          ) : (
            <>
              <ul className="mt-3 space-y-2">
                {findings.slice(0, 3).map(findingEntry)}
              </ul>
              {findings.length > 3 && (
                <Disclosure className="mt-2">
                  <DisclosureSummary className="py-3 text-sm">
                    {counted(findings.length - 3, "more finding")}
                  </DisclosureSummary>
                  <ul className="space-y-2">
                    {findings.slice(3).map(findingEntry)}
                  </ul>
                </Disclosure>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
