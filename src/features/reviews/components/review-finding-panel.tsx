"use client";
import dynamic from "next/dynamic";
const ReviewProposalPanel = dynamic(() => import("./review-proposal-panel"), {
  ssr: false,
});
import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Doc } from "../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { CODING_MODELS } from "../../../../convex/lib/coding_models";
import { isActiveWork } from "../../../../convex/lib/finding_lease";
import { Textarea } from "@/components/ui/textarea";
import { fileAtCommitUrl } from "../lib/review";
import { useDiscussionSession } from "./discussion-sessions";
import { investigationRequestFor } from "../lib/discussion-session";

type Review = Doc<"reviews">;
type Finding = NonNullable<Review["result"]>["findings"][number];
async function send(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request failed");
  return data;
}
export function ReviewFindingPanel({
  review,
  finding,
  onReviewLatest,
}: {
  review: Review;
  finding: Finding;
  onReviewLatest?: () => void;
}) {
  const discussionId = useId();
  const proposals = useQuery(api.reviewProposals.list, {
    reviewId: review._id,
    findingId: finding.id,
  });
  const history = useRef<HTMLOListElement>(null);
  const [session, update] = useDiscussionSession(finding.id, review.model);
  const {
    cursor,
    model,
    seconds,
    dollars,
    body,
    error,
    cancellation,
    sending,
  } = session;
  const thread = useQuery(api.reviewInteractions.thread, {
    reviewId: review._id,
    findingId: finding.id,
    cursor,
  });
  useEffect(() => {
    if (!cursor && history.current)
      history.current.scrollTop = history.current.scrollHeight;
  }, [cursor, thread?.messages]);
  const [capability, setCapability] = useState<{
    available: boolean;
    reason: string;
  } | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/api/reviews/investigate")
      .then((r) => r.json())
      .then((value) => {
        if (active) setCapability(value);
      })
      .catch(() => {
        if (active)
          setCapability({
            available: false,
            reason:
              "Execution service is unavailable. Static discussion remains available.",
          });
      });
    return () => {
      active = false;
    };
  }, []);
  const active = thread?.work.find((w) => isActiveWork(w.status));
  return (
    <section
      aria-label="Finding discussion"
      className="mt-2 min-w-0 rounded-md border bg-review-bg p-4"
    >
      <h3 className="text-sm font-semibold">Discuss this finding</h3>
      <p className="mt-2 text-xs text-muted-foreground">
        Private discussion at {review.headSha?.slice(0, 7)}. The original
        finding stays in the review.
      </p>
      {!thread && (
        <p role="status" className="mt-3 text-sm">
          Loading discussion…
        </p>
      )}
      <div className="mt-3 flex gap-2">
        {thread?.olderCursor && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => update({ cursor: thread.olderCursor! })}
          >
            Older messages
          </Button>
        )}
        {cursor && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => update({ cursor: undefined })}
          >
            Latest messages
          </Button>
        )}
      </div>
      <ol
        ref={history}
        tabIndex={0}
        aria-label="Discussion history"
        className="mt-4 max-h-80 overflow-y-auto space-y-4 focus-visible:outline-2 focus-visible:outline-review-link"
      >
        {thread?.messages.map((message) => (
          <li key={message._id} className="rounded-md border p-3 text-sm">
            <p className="text-xs font-medium text-muted-foreground">
              {message.role === "user" ? "You" : "Review agent"}
              {message.conclusion && ` · ${message.conclusion.verdict}`}
            </p>
            <p className="mt-2 whitespace-pre-wrap leading-6">{message.body}</p>
            {message.conclusion && (
              <>
                <p className="mt-2 text-xs font-medium">
                  {message.recordedChecks.some(
                    (c) => c.status !== "unavailable",
                  )
                    ? "Runtime evidence is limited to the recorded checks."
                    : "Static inspection. No runtime checks ran."}
                </p>
                <ul className="mt-2 space-y-1 text-xs">
                  {message.conclusion.evidence.map((e, i) => (
                    <li key={i}>
                      <a
                        className="underline"
                        target="_blank"
                        rel="noopener noreferrer"
                        href={fileAtCommitUrl(
                          e.revision === "head"
                            ? (review.sourceOwner ?? review.repoOwner)
                            : review.repoOwner,
                          e.revision === "head"
                            ? (review.sourceRepo ?? review.repoName)
                            : review.repoName,
                          e.commit,
                          e.path,
                          e.line,
                        )}
                      >
                        {e.path}:{e.line} · {e.commit.slice(0, 7)}
                      </a>
                      <pre className="mt-1 overflow-auto whitespace-pre-wrap">
                        {e.quote}
                      </pre>
                    </li>
                  ))}
                </ul>
                {message.conclusion.assumptions.length > 0 && (
                  <details className="mt-2">
                    <summary>Assumptions and limits</summary>
                    <ul className="mt-2 list-disc pl-4 text-xs">
                      {message.conclusion.assumptions.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </li>
        ))}
      </ol>
      <div
        aria-live="polite"
        role="status"
        className="mt-3 text-xs text-muted-foreground"
      >
        {active?.progress}
        {cancellation && <p>{cancellation}</p>}
        {thread?.work
          .filter((w) => w.status === "failed" || w.status === "cancelled")
          .slice(0, 2)
          .map((w) => (
            <p key={w._id}>
              {w.status === "failed"
                ? w.error
                : "Cancellation saved. Further results are blocked; repository execution also has a fixed deadline."}
            </p>
          ))}
      </div>
      <form
        className="mt-4 space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          update({ error: "" });
          update({ sending: true });
          const pending =
            session.pending?.body === body.trim()
              ? session.pending
              : { body: body.trim(), requestId: crypto.randomUUID() };
          update({ pending });
          try {
            await send("/api/reviews/discuss", {
              reviewId: review._id,
              findingId: finding.id,
              ...pending,
            });
            update({ body: "" });
            update({ cursor: undefined });
            update({ pending: null });
          } catch (e) {
            update({ error: (e as Error).message });
          } finally {
            update({ sending: false });
          }
        }}
      >
        <label htmlFor={discussionId} className="text-xs font-medium">
          Challenge the claim or ask for more evidence
        </label>
        <Textarea
          id={discussionId}
          data-finding-discussion={finding.id}
          value={body}
          onChange={(event) => update({ body: event.target.value })}
          maxLength={4000}
          rows={3}
          disabled={Boolean(active) || sending}
        />
        <Button size="sm" disabled={!body.trim() || Boolean(active) || sending}>
          {sending ? "Sending…" : "Ask review agent"}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
      <details className="mt-5 rounded-md border p-3" open={Boolean(active)}>
        <summary className="cursor-pointer py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-review-link">
          Investigate and propose fix
        </summary>
        {thread?.work
          .filter((w) => ["queued", "failed", "cancelled"].includes(w.status))
          .slice(0, 3)
          .map((w) => (
            <Button
              key={w._id}
              className="mt-3 mr-2"
              variant="outline"
              size="sm"
              disabled={sending || Boolean(active && active._id !== w._id)}
              onClick={async () => {
                update({ sending: true });
                update({ error: "" });
                try {
                  await send("/api/reviews/work/retry", { workId: w._id });
                } catch (e) {
                  update({ error: (e as Error).message });
                } finally {
                  update({ sending: false });
                }
              }}
            >
              {w.status === "queued"
                ? "Retry dispatch"
                : `Retry ${w.kind} within saved cap`}
            </Button>
          ))}
        {active && (
          <Button
            className="mt-3"
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                const result = await send("/api/reviews/work/cancel", {
                  workId: active._id,
                });
                if (
                  active.requestId === session.investigationRequest?.requestId
                )
                  update({ investigationRequest: null });
                update({
                  cancellation:
                    result.executionStopped === true
                      ? "Cancellation saved and repository execution stopped."
                      : result.executionStopped === false
                        ? "Cancellation saved. Immediate execution stop could not be confirmed; the sandbox deadline remains enforced."
                        : "Cancellation saved. No repository execution was attached.",
                });
              } catch (e) {
                update({ error: (e as Error).message });
              }
            }}
          >
            Cancel work
          </Button>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          {!capability
            ? "Checking isolated execution availability…"
            : capability.available
              ? capability.reason
              : `${capability.reason} Investigation will use static source inspection only; no checks will run.`}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Tools inspect pinned source and run offline Node.js checks. Checkouts
          are deleted after work; saved evidence and checks remain private.
          Additional spending requires another explicit request.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
          <label>
            Model
            <select
              className="mt-1 w-full rounded-md border bg-background p-2 text-base sm:text-sm"
              value={model}
              onChange={(e) => update({ model: e.target.value })}
            >
              {CODING_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · OpenRouter
                </option>
              ))}
            </select>
          </label>
          <label>
            Time limit (seconds)
            <input
              className="mt-1 w-full rounded-md border bg-background p-2 text-base sm:text-sm"
              type="number"
              min={30}
              max={300}
              value={seconds}
              onChange={(e) => update({ seconds: Number(e.target.value) })}
            />
          </label>
          <label>
            Cost cap ($)
            <input
              className="mt-1 w-full rounded-md border bg-background p-2 text-base sm:text-sm"
              type="number"
              min={0.1}
              max={10}
              step={0.1}
              value={dollars}
              onChange={(e) => update({ dollars: Number(e.target.value) })}
            />
          </label>
        </div>
        <Button
          className="mt-3 bg-review-text text-review-bg hover:bg-review-text/90"
          size="sm"
          disabled={!capability || !thread || Boolean(active) || sending}
          onClick={async () => {
            update({ error: "" });
            update({ sending: true });
            const previous = thread?.work.find(
              (work) =>
                work.requestId === session.investigationRequest?.requestId,
            );
            const investigationRequest = investigationRequestFor(
              previous && !isActiveWork(previous.status)
                ? { ...session, investigationRequest: null }
                : session,
            );
            update({ investigationRequest });
            try {
              await send("/api/reviews/investigate", {
                reviewId: review._id,
                findingId: finding.id,
                ...investigationRequest,
              });
              update({ investigationRequest: null });
            } catch (e) {
              update({ error: (e as Error).message });
            } finally {
              update({ sending: false });
            }
          }}
        >
          Investigate and propose fix
        </Button>
        {thread?.work
          .filter((w) => w.kind === "investigation")
          .slice(0, 3)
          .map((w) => (
            <div key={w._id} className="mt-3 rounded-md border p-3 text-xs">
              <p>
                Investigation {w.status}, {w.maxDurationMs / 1000}s limit. $
                {(w.reservedCostMicros / 1_000_000).toFixed(2)} reserved of a $
                {(w.maxCostMicros / 1_000_000).toFixed(2)} maximum.
              </p>
              {w.result && (
                <p className="mt-2">
                  {w.result.verdict}: {w.result.explanation}
                </p>
              )}
              {w.proposalError && (
                <p className="mt-2">Proposal unavailable: {w.proposalError}</p>
              )}
              {w.error && (
                <p className="mt-2">
                  {w.stopReason ?? "infrastructure"}: {w.error}
                </p>
              )}
              {!w.checks?.length && (
                <p className="mt-2">
                  Checks unavailable. No runtime validation was recorded.
                </p>
              )}
              {w.checks?.map((check, i) => (
                <details key={i} className="mt-2">
                  <summary>
                    {check.status}: {check.command.join(" ")}
                  </summary>
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap">
                    {check.output}
                  </pre>
                </details>
              ))}
            </div>
          ))}
        {Boolean(thread?.attempts.length) && (
          <details className="mt-3 rounded-md border p-3 text-xs">
            <summary>Earlier attempts ({thread?.attempts.length})</summary>
            <div
              className="max-h-48 overflow-y-auto"
              tabIndex={0}
              aria-label="Earlier attempt history"
            >
              {" "}
              {thread?.attempts.map((previous) => (
                <details
                  key={previous._id}
                  className="mt-3 rounded-md border p-3 text-xs"
                >
                  <summary>
                    Earlier attempt {previous.attempt}: {previous.status}{" "}
                    {previous.stopReason && `· ${previous.stopReason}`}
                  </summary>
                  {previous.result && (
                    <p className="mt-2">
                      {previous.result.verdict}: {previous.result.explanation}
                    </p>
                  )}
                  {previous.proposalError && <p>{previous.proposalError}</p>}
                  {previous.checks.map((check, i) => (
                    <details key={i} className="mt-2">
                      <summary>
                        {check.status}: {check.command.join(" ")}
                      </summary>
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap">
                        {check.output}
                      </pre>
                    </details>
                  ))}
                </details>
              ))}
            </div>
          </details>
        )}
        {proposals?.map((proposal) => (
          <ReviewProposalPanel
            key={proposal._id}
            proposal={proposal}
            onReviewLatest={onReviewLatest}
          />
        ))}
      </details>
    </section>
  );
}
