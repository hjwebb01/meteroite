import type { Octokit } from "octokit";
import { compareReviewSnapshots } from "../../../../convex/lib/review_reassessment";
import {
  validateChangeGroups,
  validateHotspots,
} from "../../../../convex/lib/review_navigation";
import { createAssessment } from "../../../../convex/lib/review_assessment";
import { triageFindings } from "../lib/finding-triage";
import { validateFindings } from "../lib/review";
import type { PartReport, ReviewRun } from "./review-run";

/**
 * Validates the final report against its evidence and builds the saved
 * result. Runs once per review, after investigation and any synthesis.
 */
export async function finalizeReview(
  octokit: Octokit,
  run: ReviewRun,
  { output, evidence, filesRead, warnings: coverageWarnings }: PartReport,
  rejectedEarlier = 0,
) {
  const { snapshot, reviewId } = run;
  const { findings: validatedFindings, rejected: rejectedNow } =
    validateFindings(
      output.findings,
      snapshot.files,
      evidence,
      run.previousFindings,
      reviewId,
    );
  const rejected = rejectedNow + rejectedEarlier;
  const triage = await triageFindings(validatedFindings);
  const findings = triage.findings.map((finding) => ({
    ...finding,
    evidence: finding.evidence.map((entry) => ({
      ...entry,
      commitSha: snapshot.headSha,
      blobSha:
        snapshot.paths.find((file) => file.path === entry.path)?.sha ??
        snapshot.files.find((file) => file.filename === entry.path)
          ?.headBlobSha,
    })),
  }));
  const { hotspots, rejected: rejectedHotspots } = validateHotspots(
    output.hotspots,
    snapshot.files,
    snapshot,
    reviewId,
  );
  const { groups: changeGroups, rejected: rejectedGroups } =
    validateChangeGroups(
      output.changeGroups ?? [],
      snapshot.files.flatMap((file) => file.hunks ?? []),
      reviewId,
    );
  const { data: latest } = await octokit.rest.pulls.get({
    owner: run.repository.owner,
    repo: run.repository.name,
    pull_number: run.repository.pullNumber,
  });
  const outdated =
    latest.head.sha !== snapshot.headSha ||
    latest.base.sha !== snapshot.baseSha;
  const warnings = [
    ...coverageWarnings,
    ...output.limitations.slice(0, 10).map((l) => l.slice(0, 500)),
  ];
  if (rejectedGroups)
    warnings.push(
      `${rejectedGroups} change group(s) were withheld because their hunk references did not match the saved snapshot.`,
    );
  if (rejectedHotspots)
    warnings.push(
      `${rejectedHotspots} hotspot(s) were withheld because their code references could not be validated against the reviewed snapshot.`,
    );
  if (rejected)
    warnings.push(
      `${rejected} proposed finding(s) were withheld because their line anchors or quoted evidence could not be validated, or they were duplicates.`,
    );
  if (triage.withheld)
    warnings.push(
      `${triage.withheld} finding(s) were withheld by triage as likely false positives or duplicates.`,
    );
  if (triage.adjusted)
    warnings.push(
      `Triage adjusted the severity of ${triage.adjusted} finding(s).`,
    );
  if (triage.warning) warnings.push(triage.warning);
  if (outdated)
    warnings.push(
      "The PR changed during this review. Findings refer to the recorded commit; review the latest commits before relying on them.",
    );
  const assessment = createAssessment({
    draft: output.assessment,
    headSha: snapshot.headSha,
    baseSha: snapshot.baseSha,
    signals: snapshot.signals,
    evidenceLines: evidence,
    findings,
    coverageReasons: warnings,
    assessedAt: Date.now(),
  });
  const reassessment = run.previous
    ? compareReviewSnapshots({
        previous: run.previous,
        previousFiles: run.previousFiles,
        current: snapshot,
        findings,
        comparedAt: Date.now(),
      })
    : undefined;
  return {
    ...(reassessment ? { reassessment } : {}),
    assessment,
    hotspots,
    changeGroups,
    summary: output.summary,
    findings,
    outdated,
    coverage: {
      changedFiles: snapshot.changedFiles,
      diffFiles: snapshot.files.filter((f) => f.patch).map((f) => f.filename),
      filesRead: [...new Set(filesRead)],
      warnings,
    },
  };
}
