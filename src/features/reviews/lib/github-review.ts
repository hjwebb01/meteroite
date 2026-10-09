import { RequestError, type Octokit } from "octokit";
import type { Doc } from "../../../../convex/_generated/dataModel";
import {
  CATEGORY_LABEL,
  isNitpick,
  severityCounts,
  sortFindings,
  type Finding,
} from "./finding-presentation";

type Review = Doc<"reviews">;

// GitHub rejects review and comment bodies longer than this.
const MAX_BODY_CHARS = 65_000;

const SEVERITY_LABEL = { high: "High", medium: "Medium", low: "Low" } as const;

/** Hidden in the rendered review; finds a post whose result was never recorded. */
export function reviewMarker(reviewId: string) {
  return `<!-- meteroite-review:${reviewId} -->`;
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function findingLabel(finding: Finding) {
  return [
    SEVERITY_LABEL[finding.severity],
    finding.category && CATEGORY_LABEL[finding.category],
  ]
    .filter(Boolean)
    .join(" · ");
}

function findingComment(finding: Finding) {
  return [
    `**${findingLabel(finding)}: ${finding.title}**`,
    ``,
    finding.explanation,
    ``,
    `**Suggested fix:** ${finding.suggestion}`,
  ].join("\n");
}

function location(finding: Finding) {
  return `\`${finding.path}:${finding.line}\`${finding.side === "LEFT" ? " (removed line)" : ""}`;
}

/**
 * One GitHub review per saved review: inline comments for main findings,
 * nitpicks folded into the summary. `inline: false` puts every finding in
 * the summary, for when GitHub cannot resolve an inline anchor.
 */
export function buildGithubReview(
  review: Review,
  findings: Finding[],
  { inline = true } = {},
) {
  const ordered = sortFindings(findings);
  const main = ordered.filter((f) => !isNitpick(f));
  const nitpicks = ordered.filter(isNitpick);
  const counts = severityCounts(ordered);
  const tally = (["high", "medium", "low"] as const)
    .filter((s) => counts[s])
    .map((s) => `${counts[s]} ${s}`)
    .join(", ");
  const sections = [
    reviewMarker(review._id),
    `## Meteroite review`,
    ``,
    review.result?.summary ?? "",
    ``,
    ordered.length
      ? `**Findings:** ${tally}${nitpicks.length ? ` (${nitpicks.length} nitpick${nitpicks.length === 1 ? "" : "s"} below)` : ""}`
      : `No findings.`,
  ];
  if (!inline && main.length)
    sections.push(
      ``,
      `### Findings`,
      ...main.map((f) => `\n${location(f)}\n\n${findingComment(f)}`),
    );
  if (nitpicks.length)
    sections.push(
      ``,
      `<details>`,
      `<summary>Nitpicks (${nitpicks.length})</summary>`,
      ...nitpicks.map((f) => `\n${location(f)}\n\n${findingComment(f)}`),
      ``,
      `</details>`,
    );
  sections.push(
    ``,
    `<sub>Reviewed commit ${review.headSha?.slice(0, 7) ?? "unknown"}.</sub>`,
  );
  return {
    body: truncate(sections.join("\n"), MAX_BODY_CHARS),
    comments: inline
      ? main.map((f) => ({
          path: f.path,
          line: f.line,
          side: f.side,
          body: truncate(findingComment(f), MAX_BODY_CHARS),
        }))
      : [],
  };
}

async function findPostedReview(octokit: Octokit, review: Review) {
  const marker = reviewMarker(review._id);
  const posted = await octokit.paginate(octokit.rest.pulls.listReviews, {
    owner: review.repoOwner,
    repo: review.repoName,
    pull_number: review.pullNumber,
    per_page: 100,
  });
  return posted.find((r) => r.body?.includes(marker));
}

/**
 * Posts the review as a non-blocking COMMENT review on the reviewed commit.
 * A post that reached GitHub but was never recorded is found by its marker
 * instead of being posted twice.
 */
export async function publishGithubReview(
  octokit: Octokit,
  review: Review,
  findings: Finding[],
) {
  if (!review.headSha) throw new Error("This review has no pinned commit.");
  const existing = await findPostedReview(octokit, review);
  if (existing) return { id: existing.id, url: existing.html_url };
  const post = (inline: boolean) =>
    octokit.rest.pulls.createReview({
      owner: review.repoOwner,
      repo: review.repoName,
      pull_number: review.pullNumber,
      commit_id: review.headSha,
      event: "COMMENT",
      ...buildGithubReview(review, findings, { inline }),
    });
  try {
    const { data } = await post(true);
    return { id: data.id, url: data.html_url };
  } catch (error) {
    // 422: an anchor no longer resolves, e.g. the commit left the PR.
    if (!(error instanceof RequestError && error.status === 422)) throw error;
    const { data } = await post(false);
    return { id: data.id, url: data.html_url };
  }
}
