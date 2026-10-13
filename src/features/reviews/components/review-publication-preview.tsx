"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Doc } from "../../../../convex/_generated/dataModel";
import type { ReviewPublicationPreviewData } from "../lib/github-publication";
import type { GithubReviewPayload } from "../lib/github-review";

function OutgoingReview({
  label,
  payload,
}: {
  label: string;
  payload: GithubReviewPayload;
}) {
  return (
    <section aria-label={label} className="min-w-0 space-y-4">
      <h3 className="text-sm font-semibold text-review-text">{label}</h3>
      <div className="review-source-plane rounded-md border border-review-border p-4">
        <h4 className="mb-3 text-xs font-medium text-review-muted">
          Exact review body · Markdown
        </h4>
        <pre className="whitespace-pre-wrap break-words text-xs leading-6 text-review-body [overflow-wrap:anywhere]">
          {payload.body}
        </pre>
      </div>
      <h4 className="text-xs font-medium text-review-muted">
        Inline comments · {payload.comments.length}
      </h4>
      {!payload.comments.length && (
        <p className="text-xs text-review-muted">
          No inline comments in this representation.
        </p>
      )}
      {payload.comments.map((comment, index) => (
        <article
          key={`${comment.path}:${comment.side}:${comment.line}:${index}`}
          className="review-source-plane min-w-0 rounded-md border border-review-border p-4"
        >
          <h5 className="mb-3 break-words text-xs font-medium text-review-link [overflow-wrap:anywhere]">
            {comment.path}:{comment.line} ·{" "}
            {comment.side === "LEFT" ? "Old / removed side" : "New side"}
          </h5>
          <pre className="whitespace-pre-wrap break-words text-xs leading-6 text-review-body [overflow-wrap:anywhere]">
            {comment.body}
          </pre>
        </article>
      ))}
    </section>
  );
}

export type ReviewPublicationPreviewProps = {
  review: Doc<"reviews">;
  onClose: () => void;
  onReviewLatest: () => void;
};

export function ReviewPublicationPreview(props: ReviewPublicationPreviewProps) {
  return <PublicationPlane key={props.review._id} {...props} />;
}

function PublicationPlane({
  review,
  onClose,
  onReviewLatest,
}: ReviewPublicationPreviewProps) {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [preview, setPreview] = useState<ReviewPublicationPreviewData | null>(
    null,
  );
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const [published, setPublished] = useState<Doc<"reviews">["githubReview"]>(
    review.githubReview,
  );

  useEffect(() => {
    const previousFocus = document.activeElement;
    heading.current?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus({ preventScroll: true });
    };
  }, [review._id]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      setPreview(null);
      try {
        const response = await fetch(
          `/api/reviews/publish?reviewId=${encodeURIComponent(review._id)}`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );
        const data: { preview?: ReviewPublicationPreviewData; error?: string } =
          await response.json();
        if (!response.ok || !data.preview)
          throw new Error(
            data.error ??
              "The publication preview could not be loaded. Try refreshing it.",
          );
        if (!controller.signal.aborted) {
          setPreview(data.preview);
          if (data.preview.githubReview)
            setPublished(data.preview.githubReview);
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "The publication preview could not be loaded. Try refreshing it.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [review._id, review.githubReview, refresh]);

  async function publish() {
    if (!preview?.confirmation || posting || loading || published) return;
    setPosting(true);
    setError("");
    try {
      const response = await fetch("/api/reviews/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewId: review._id,
          confirmation: preview.confirmation,
        }),
      });
      const data: {
        githubReview?: Doc<"reviews">["githubReview"];
        error?: string;
      } = await response.json();
      if (!response.ok || !data.githubReview) {
        setPreview((current) =>
          current ? { ...current, confirmation: null } : current,
        );
        throw new Error(
          data.error ??
            "Publication could not be confirmed. Refresh publication status before trying again.",
        );
      }
      setPublished(data.githubReview);
    } catch (cause) {
      // A lost response can follow a successful write. Require status recovery,
      // not a second blind confirmation using the same preview.
      setPreview((current) =>
        current ? { ...current, confirmation: null } : current,
      );
      setError(
        cause instanceof Error
          ? cause.message
          : "Publication could not be confirmed. Refresh publication status before trying again.",
      );
    } finally {
      setPosting(false);
    }
  }

  async function resetAttempt() {
    if (!preview?.resetAttemptId || posting || loading) return;
    setPosting(true);
    setError("");
    try {
      const response = await fetch("/api/reviews/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewId: review._id,
          action: "reset_uncertain",
          attemptId: preview.resetAttemptId,
        }),
      });
      const data: {
        reset?: boolean;
        githubReview?: Doc<"reviews">["githubReview"];
        error?: string;
      } = await response.json();
      if (!response.ok)
        throw new Error(
          data.error ?? "Publication status could not be resolved.",
        );
      if (data.githubReview) setPublished(data.githubReview);
      setRefresh((value) => value + 1);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Publication status could not be resolved.",
      );
    } finally {
      setPosting(false);
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      aria-busy={loading || posting}
      className="review-reading-plane mx-auto w-full min-w-0 max-w-5xl rounded-md p-4 sm:p-8"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !posting) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <p className="text-xs text-review-link">
            Private review → GitHub publication
          </p>
          <h2
            ref={heading}
            tabIndex={-1}
            id={headingId}
            className="text-lg font-semibold text-review-text focus-visible:outline-2 focus-visible:outline-review-link focus-visible:outline-offset-4"
          >
            Inspect exact outgoing review
          </h2>
          <p className="break-words text-sm text-review-body [overflow-wrap:anywhere]">
            {review.repoOwner}/{review.repoName} · Pull request #
            {review.pullNumber}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="min-h-10"
          onClick={onClose}
          disabled={posting}
        >
          Return to private review
        </Button>
      </div>
      <p className="mt-5 max-w-3xl text-xs leading-6 text-review-muted">
        This posts a non-blocking COMMENT review, not approval, application, or
        merge. Private discussions, explicit section read marks, and proposed
        patches remain private. Leaving this preview does not publish anything.
      </p>
      <div role="status" className="mt-5 text-xs leading-6 text-review-body">
        {loading
          ? "Loading exact output and checking the live PR revision…"
          : posting
            ? "Publishing the confirmed output. Waiting for GitHub confirmation…"
            : published
              ? "Publication confirmed by GitHub."
              : preview?.publicationState === "recovering"
                ? "A prior publication is running or its outcome is uncertain. Refresh status to recover its GitHub result; another review will not be sent."
                : preview?.freshness.reason}
      </div>
      {error && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-review-border p-3 text-sm text-review-text"
        >
          {error}
        </p>
      )}
      {preview?.resetAttemptId && !published && (
        <div className="mt-4 rounded-md border border-review-border p-4 text-xs leading-6 text-review-body">
          <p>
            No matching GitHub review was found, and this attempt is over 15
            minutes old. You can reset it and inspect a fresh preview. If GitHub
            accepted a delayed request, publishing again could create a
            duplicate. Resetting itself sends nothing.
          </p>
          <Button
            className="mt-3"
            variant="outline"
            disabled={loading || posting}
            onClick={() => void resetAttempt()}
          >
            Reset uncertain attempt and inspect a new preview
          </Button>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          type="button"
          variant="outline"
          className="min-h-10"
          disabled={loading || posting}
          onClick={() => setRefresh((value) => value + 1)}
        >
          {preview?.publicationState === "recovering" || published
            ? "Refresh publication status"
            : "Refresh preview and freshness"}
        </Button>
        {!loading && preview?.freshness.state !== "current" && !published && (
          <Button
            type="button"
            variant="outline"
            className="min-h-10"
            disabled={posting}
            onClick={onReviewLatest}
          >
            Review latest commits
          </Button>
        )}
        {published && (
          <a
            href={published.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-10 items-center text-xs text-review-link underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-review-link"
          >
            View confirmed review on GitHub
          </a>
        )}
      </div>
      {preview && !published && (
        <div className="mt-8 min-w-0 space-y-8">
          <dl className="grid min-w-0 gap-3 text-xs sm:grid-cols-[auto_1fr]">
            <dt className="text-review-muted">Exact target</dt>
            <dd className="break-words text-review-text [overflow-wrap:anywhere]">
              {preview.target.repoOwner}/{preview.target.repoName} PR #
              {preview.target.pullNumber}, {preview.target.event} review
            </dd>
            <dt className="text-review-muted">Saved commit</dt>
            <dd className="break-all text-review-text">
              {preview.target.headSha}
            </dd>
            <dt className="text-review-muted">Saved base tip</dt>
            <dd className="break-all text-review-text">
              {preview.target.baseTipSha ||
                "Unavailable, so publication is blocked"}
            </dd>
            <dt className="text-review-muted">Live revision status</dt>
            <dd className="text-review-text">
              {preview.freshness.state === "current"
                ? "Current at the last live check"
                : preview.freshness.state === "outdated"
                  ? "Changed, so publication is blocked"
                  : "Unknown, so publication is blocked"}
            </dd>
            {preview.freshness.state !== "unavailable" && (
              <>
                <dt className="text-review-muted">Observed PR head / base</dt>
                <dd className="break-all text-review-body">
                  {preview.freshness.headSha} / {preview.freshness.baseTipSha}
                </dd>
              </>
            )}
          </dl>
          <section
            aria-label="Excluded findings"
            className="text-xs leading-6 text-review-muted"
          >
            <h3 className="font-semibold text-review-text">
              Excluded by investigation · {preview.excludedFindings.length}
            </h3>
            {preview.excludedFindings.length ? (
              <ul className="mt-2 list-inside list-disc space-y-1">
                {preview.excludedFindings.map((finding) => (
                  <li
                    key={finding.id}
                    className="break-words [overflow-wrap:anywhere]"
                  >
                    {finding.title} · retracted as incorrect
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2">
                No findings are currently retracted as incorrect.
              </p>
            )}
          </section>
          <OutgoingReview label="Normal publication" payload={preview.normal} />
          <section
            aria-label="Possible summary-only fallback"
            className="min-w-0 border-t border-review-border pt-6"
          >
            <p className="mb-4 text-xs leading-6 text-review-muted">
              If GitHub rejects inline placement, only this exact summary-only
              representation may be sent. Body limits and truncation are already
              reflected below. A changed revision or finding requires a new
              preview before either representation can be sent.
            </p>
            <OutgoingReview
              label="Possible summary-only fallback"
              payload={preview.fallback}
            />
          </section>
          <div className="border-t border-review-border pt-6">
            <p className="mb-3 text-xs leading-6 text-review-muted">
              Confirmation authorizes the exact normal output and the exact
              possible fallback above, at saved commit{" "}
              {preview.target.headSha.slice(0, 7)}. GitHub freshness and
              eligible content are checked again before sending.
            </p>
            <Button
              type="button"
              className="h-auto min-h-11 max-w-full whitespace-normal bg-review-link px-4 py-3 text-review-bg hover:bg-review-link/90 motion-reduce:transform-none motion-reduce:transition-none"
              disabled={!preview.confirmation || loading || posting}
              onClick={() => void publish()}
            >
              {posting
                ? "Publishing confirmed review…"
                : `Confirm and publish to ${preview.target.repoOwner}/${preview.target.repoName} #${preview.target.pullNumber}`}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
