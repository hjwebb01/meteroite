"use client";
import { applicationAction } from "../../../../convex/lib/review_application";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useState, useRef } from "react";
import { parseDiffFromFile } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import type { Doc } from "../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
export default function ReviewProposalPanel({
  proposal,
  onReviewLatest,
}: {
  proposal: Doc<"reviewProposals">;
  onReviewLatest?: () => void;
}) {
  const applications = useQuery(api.reviewApplications.list, {
    proposalId: proposal._id,
  });
  const action = applicationAction(applications?.[0]);
  const requestId = useRef<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [inspected, setInspected] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  return (
    <section
      aria-label="Proposed fix"
      className="mt-4 rounded-lg border p-3 text-xs"
    >
      <h3 className="font-semibold">
        Proposed fix · {proposal.sourceSha.slice(0, 7)}
      </h3>
      <p className="mt-2">{proposal.rationale}</p>
      <p className="mt-2 text-muted-foreground">
        Saved proposal. The current PR assessment is unchanged. Validation is
        limited to the checks below.
      </p>
      <Button
        size="sm"
        variant="outline"
        className="mt-3"
        onClick={() => {
          setInspected(true);
          setShowDiff((v) => !v);
        }}
      >
        {showDiff ? "Original evidence" : "Inspect proposed diff"}
      </Button>
      {showDiff ? (
        proposal.files.map((file) => (
          <div key={file.path} className="mt-3 overflow-auto">
            <FileDiff
              fileDiff={parseDiffFromFile(
                file.original === null
                  ? null
                  : { name: file.path, contents: file.original },
                file.replacement === null
                  ? null
                  : { name: file.path, contents: file.replacement },
              )}
              options={{ diffStyle: "unified" }}
            />
          </div>
        ))
      ) : (
        <p className="mt-3">
          {proposal.investigation.explanation} Original source and discussion
          remain above; PR navigation remains available.
        </p>
      )}
      {proposal.checks.map((check, i) => (
        <details key={i} className="mt-3">
          <summary>
            {check.status}:{" "}
            {check.command.join(" ") || "validation unavailable"}
          </summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap">
            {check.output}
          </pre>
        </details>
      ))}
      {action === "reassess" && (
        <div className="mt-4">
          <p className="text-muted-foreground">
            The saved proposal needs a new assessment and investigation of
            current code.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={onReviewLatest}
            disabled={!onReviewLatest}
          >
            Review latest commits
          </Button>
        </div>
      )}
      {action !== "applied" && action !== "reassess" && (
        <Button
          size="sm"
          className="mt-4"
          disabled={!inspected || applying || action === "wait"}
          onClick={async () => {
            setApplying(true);
            setError("");
            requestId.current ??= crypto.randomUUID();
            try {
              const response = await fetch("/api/reviews/apply", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  proposalId: proposal._id,
                  expectedDigest: proposal.digest,
                  requestId: requestId.current,
                }),
              });
              const data = await response.json();
              if (!response.ok) throw new Error(data.error);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setApplying(false);
            }
          }}
        >
          {action === "wait"
            ? applications?.[0]?.status === "writing"
              ? "Writing inspected manifest…"
              : "Application in progress…"
            : applications?.length
              ? "Retry / reconcile application"
              : `Commit proposal to ${proposal.sourceOwner}/${proposal.sourceRepo}:${proposal.sourceBranch}`}
        </Button>
      )}
      <p className="mt-2 font-mono text-muted-foreground">
        Manifest {proposal.digest.slice(0, 12)}
      </p>
      {!inspected && (
        <p className="mt-2">
          Inspect the proposed diff and validation before applying.
        </p>
      )}
      {applications?.map((application) => (
        <div key={application._id} className="mt-3">
          <p>Application {application.status}</p>
          {application.error && <p role="alert">{application.error}</p>}
          {application.commitUrl && (
            <>
              <a
                className="underline"
                href={application.commitUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Verified commit {application.commitSha?.slice(0, 7)}
              </a>
              <p className="mt-2">
                This review describes the older {proposal.sourceSha.slice(0, 7)}{" "}
                snapshot. Use the review form again to assess the updated code;
                scrutiny has not changed.
              </p>
            </>
          )}
        </div>
      ))}
      {error && (
        <p role="alert" className="mt-3 text-destructive">
          {error}
        </p>
      )}
      {!applications?.some((a) => a.status === "applied") && (
        <p className="mt-3 text-muted-foreground">
          Generating this proposal made no remote change. Applying commits
          exactly this manifest to the saved source branch. Direct push
          permission to the source repository is required; upstream maintainer
          permission alone is unsupported. No merge or review publication
          occurs.
        </p>
      )}
    </section>
  );
}
