import type { Doc } from "../../../../convex/_generated/dataModel";

type Review = Doc<"reviews">;
export type Finding = NonNullable<Review["result"]>["findings"][number];

const SEVERITY_RANK = { high: 0, medium: 1, low: 2 } as const;

export const CATEGORY_LABEL: Record<
  NonNullable<Finding["category"]>,
  string
> = {
  bug: "Bug",
  security: "Security",
  performance: "Performance",
  data_integrity: "Data integrity",
  test_gap: "Test gap",
  maintainability: "Maintainability",
};

/** Worst severity first, then the finding the reviewer is surest of. */
export function sortFindings<T extends Finding>(findings: T[]) {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      (b.confidence ?? 0) - (a.confidence ?? 0),
  );
}

/** Low-severity style or coverage remarks, or guesses, stay out of the main list. */
export function isNitpick(finding: Finding) {
  return (
    finding.severity === "low" &&
    (finding.category === "maintainability" ||
      finding.category === "test_gap" ||
      (finding.confidence !== undefined && finding.confidence <= 2))
  );
}

export function severityCounts(findings: Finding[]) {
  const counts = { high: 0, medium: 0, low: 0 };
  for (const finding of findings) counts[finding.severity]++;
  return counts;
}

/** A self-contained brief a coding agent can act on without this review open. */
export function findingAgentPrompt(finding: Finding, review: Review) {
  const location = `${finding.path}:${finding.line}${finding.side === "LEFT" ? " (removed line)" : ""}`;
  const source = `${review.sourceOwner ?? review.repoOwner}/${review.sourceRepo ?? review.repoName}`;
  return [
    `Verify this code review finding against the current code and fix it only if it is a real issue.`,
    ``,
    `Repository: ${source} at commit ${review.headSha ?? "unknown"}`,
    `Location: ${location}`,
    `Severity: ${finding.severity}${finding.category ? ` · ${CATEGORY_LABEL[finding.category]}` : ""}`,
    ``,
    `Problem: ${finding.title}`,
    finding.explanation,
    ``,
    `Evidence:`,
    ...finding.evidence.map(
      (entry) => `- ${entry.path}:${entry.line}: ${entry.quote}`,
    ),
    ``,
    `Suggested fix: ${finding.suggestion}`,
  ].join("\n");
}
