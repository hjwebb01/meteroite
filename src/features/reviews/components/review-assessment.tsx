import { useId } from "react";
import {
  readAssessment,
  SCRUTINY_GUIDANCE,
  SCRUTINY_RUBRIC,
  type PersistedAssessment,
} from "../../../../convex/lib/review_assessment";
import { fileAtCommitUrl } from "../lib/review";

const READINESS_LABELS = {
  ready_for_review: "Ready for review",
  needs_attention: "Needs attention",
  incomplete: "Assessment incomplete",
};

export function ReviewAssessment({
  assessment: saved,
  heading = "PR assessment",
  sourceOwner,
  sourceRepo,
}: {
  assessment?: PersistedAssessment;
  heading?: string;
  sourceOwner: string;
  sourceRepo: string;
}) {
  const headingId = useId();
  const assessment = readAssessment(saved);
  return (
    <section
      aria-labelledby={headingId}
      className="mb-7 rounded-xl border bg-sidebar p-6"
    >
      <h2
        id={headingId}
        className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
      >
        {heading}
      </h2>
      {assessment.state === "legacy" ? (
        <div className="mt-3">
          <p className="font-medium">Assessment unavailable</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {assessment.reason}
          </p>
        </div>
      ) : (
        <>
          <p className="mt-3 font-medium">
            {READINESS_LABELS[assessment.readiness.state]}
          </p>
          <div className="mt-4 border-t pt-4">
            <h3 className="text-sm font-medium">Human review needed</h3>
            {assessment.state === "complete" ? (
              <>
                <p className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-semibold tabular-nums">
                    {assessment.score}
                    <span className="text-base font-normal text-muted-foreground">
                      {" "}
                      / 5
                    </span>
                  </span>
                  <span className="text-sm font-medium">
                    {SCRUTINY_GUIDANCE[assessment.score].label}
                  </span>
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {SCRUTINY_GUIDANCE[assessment.score].guidance}
                </p>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm font-medium">
                  Assessment incomplete
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground">
                  {assessment.missingEvidence.map((reason, index) => (
                    <li key={index}>{reason}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            These signals guide human attention. They do not approve merging.
          </p>
          <details className="mt-4 border-t pt-3">
            <summary className="cursor-pointer rounded py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
              Readiness and scrutiny reasons
            </summary>
            <div className="mt-3 space-y-5 text-sm leading-6">
              <div>
                <h3 className="font-medium">Readiness</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                  {assessment.readiness.reasons.map((reason, index) => (
                    <li key={index}>{reason}</li>
                  ))}
                </ul>
              </div>
              {assessment.state === "complete" && (
                <div>
                  <h3 className="font-medium">
                    Strongest review need sets the score
                  </h3>
                  <dl className="mt-2 space-y-3">
                    {Object.entries(assessment.dimensions).map(
                      ([dimension, rating]) => (
                        <div key={dimension}>
                          <dt className="font-medium capitalize">
                            {dimension} · {rating.level}/5
                          </dt>
                          <dd className="mt-1 text-muted-foreground">
                            {rating.reason}
                          </dd>
                        </div>
                      ),
                    )}
                  </dl>
                  <h3 className="mt-4 font-medium">Inspected evidence</h3>
                  <ul className="mt-2 space-y-3">
                    {assessment.evidence.map((item, index) => (
                      <li key={index}>
                        <a
                          href={fileAtCommitUrl(
                            sourceOwner,
                            sourceRepo,
                            assessment.headSha,
                            item.path,
                            item.line,
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="break-all font-mono text-xs text-blue-300 underline underline-offset-4"
                        >
                          {item.path}:{item.line}
                        </a>
                        <pre className="mt-1 overflow-x-auto rounded-md bg-background p-2 text-xs">
                          <code>{item.quote}</code>
                        </pre>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <h3 className="font-medium">Observed signals</h3>
                <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                  Commit {assessment.headSha}
                </p>
                {Object.entries(assessment.signals).map(([name, signal]) => (
                  <p key={name} className="mt-2 text-muted-foreground">
                    <span className="capitalize">{name}</span>
                    {": "}
                    {signal.state === "known"
                      ? typeof signal.value === "boolean"
                        ? signal.value
                          ? "Draft"
                          : "Open for review"
                        : signal.value
                      : `${signal.state}. ${signal.reason}`}
                    {" · Observed "}
                    <time dateTime={new Date(signal.observedAt).toISOString()}>
                      {new Date(signal.observedAt).toLocaleString()}
                    </time>
                  </p>
                ))}
              </div>
              {assessment.coverageReasons.length > 0 && (
                <div>
                  <h3 className="font-medium">Coverage limitations</h3>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                    {assessment.coverageReasons.map((reason, index) => (
                      <li key={index}>{reason}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </details>
        </>
      )}
      <details className="mt-3 border-t pt-3">
        <summary className="cursor-pointer rounded py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
          How scrutiny is scored
        </summary>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          The strongest need across impact, complexity, uncertainty, and
          coverage sets the score. Insufficient evidence produces an incomplete
          assessment with no score. Finding counts and severity are separate.
        </p>
        <ul className="mt-3 space-y-2 text-sm leading-6">
          {Object.entries(SCRUTINY_GUIDANCE).map(([score, entry]) => (
            <li key={score}>
              <span className="font-medium">
                {score} · {entry.label}.
              </span>{" "}
              <span className="text-muted-foreground">{entry.guidance}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          Rubric {SCRUTINY_RUBRIC.version}
        </p>
      </details>
    </section>
  );
}
