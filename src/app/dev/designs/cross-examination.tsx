"use client";

import { useEffect, useId, useRef } from "react";
import { findings, useSampleReview } from "./sample";
import styles from "./cross-examination.module.css";

const questions = [
  "Should an expired code still change the total?",
  "Can a discount turn a payment into a negative amount?",
  "Should the same code fail just because it is lowercase?",
];

export function CrossExamination() {
  const review = useSampleReview();
  const id = useId();
  const address = useRef<HTMLInputElement>(null);
  const question = useRef<HTMLHeadingElement>(null);
  const wasReviewing = useRef(false);
  const isResolved = review.resolved.includes(review.active);
  const savedNotes = review.notes[review.active] ?? [];

  useEffect(() => {
    if (review.error) address.current?.focus();
  }, [review.error]);

  useEffect(() => {
    if (review.reviewing) question.current?.focus({ preventScroll: true });
    else if (wasReviewing.current)
      address.current?.focus({ preventScroll: true });
    wasReviewing.current = review.reviewing;
  }, [review.active, review.reviewing]);

  return (
    <main className={styles.stage}>
      <div className={styles.edge}>
        <span className={styles.edgeBrand}>meteroite</span>
        <span className={styles.edgeCaption}>A private perspective</span>
      </div>

      {!review.reviewing ? (
        <div className={styles.landing}>
          <header className={styles.landingHeader}>
            <span className={styles.eyebrow}>Cross-examination</span>
            <span className={styles.sampleLabel}>Local design experiment</span>
          </header>

          <section
            className={styles.introduction}
            aria-labelledby={`${id}-intro`}
          >
            <p className={styles.kicker}>Private pull request review</p>
            <h1 id={`${id}-intro`} className={styles.headline}>
              A second opinion.
              <br />
              Before the merge.
            </h1>
            <p className={styles.introCopy}>
              One claim. The code behind it. Room to make up your own mind.
            </p>
          </section>

          <div className={styles.landingLower}>
            <section
              className={styles.preview}
              aria-labelledby={`${id}-preview`}
            >
              <p className={styles.eyebrow} id={`${id}-preview`}>
                A claim from the sample
              </p>
              <p className={styles.previewQuestion}>{questions[0]}</p>
              <p className={styles.previewSource}>
                <span>discounts.ts</span>
                <span>Line 42 · High severity</span>
              </p>
              <p className={styles.previewCopy}>
                The expiry check comes after the amount changes.
              </p>
            </section>

            <form
              className={styles.intake}
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                review.start();
              }}
            >
              <label className={styles.addressLabel} htmlFor={`${id}-address`}>
                Your pull request address
              </label>
              <div className={styles.addressLine}>
                <input
                  ref={address}
                  id={`${id}-address`}
                  name="pull-request"
                  type="url"
                  inputMode="url"
                  autoComplete="url"
                  spellCheck={false}
                  value={review.url}
                  onChange={(event) => review.setUrl(event.target.value)}
                  aria-invalid={Boolean(review.error)}
                  aria-describedby={`${id}-disclosure${review.error ? ` ${id}-error` : ""}`}
                  placeholder="github.com/owner/repo/pull/123"
                />
                <button type="submit" className={styles.begin}>
                  Open sample <span aria-hidden="true">↗</span>
                </button>
              </div>
              {review.error && (
                <p id={`${id}-error`} className={styles.error} role="alert">
                  {review.error}
                </p>
              )}
              <p id={`${id}-disclosure`} className={styles.disclosure}>
                Local sample only. The address labels the session; no repository
                is fetched. Notes stay in this session. Nothing is published to
                GitHub.
              </p>
            </form>
          </div>
          <footer className={styles.landingFooter}>
            <span>Evidence, not a conversation.</span>
            <span>You make the final call.</span>
          </footer>
        </div>
      ) : (
        <div className={styles.review}>
          <header className={styles.reviewHeader}>
            <button
              className={styles.textButton}
              type="button"
              onClick={() => review.setReviewing(false)}
            >
              <span aria-hidden="true">←</span> Back to intake
            </button>
            <p className={styles.target}>{review.target}</p>
            <span className={styles.sampleLabel}>Local sample · Private</span>
          </header>

          <div className={styles.reviewBody}>
            <div className={styles.claimHeading}>
              <p className={styles.progress}>
                Claim {review.active + 1} of {findings.length}
              </p>
              <details className={styles.claimSelector}>
                <summary>
                  All {findings.length} claims{" "}
                  <span aria-hidden="true">＋</span>
                </summary>
                <ol className={styles.claimList}>
                  {findings.map((finding, index) => (
                    <li key={finding.id}>
                      <button
                        type="button"
                        aria-current={
                          review.active === index ? "true" : undefined
                        }
                        onClick={() => review.select(index)}
                      >
                        <span className={styles.claimNumber}>{index + 1}</span>
                        <span>
                          {finding.title}
                          <small>
                            {finding.severity} severity ·{" "}
                            {review.resolved.includes(index)
                              ? "Resolved"
                              : "Open"}
                          </small>
                        </span>
                        {review.active === index && (
                          <span className={styles.currentLabel}>Current</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ol>
              </details>
            </div>

            <section
              className={styles.claim}
              aria-labelledby={`${id}-question`}
            >
              <div className={styles.claimMeta}>
                <span>{review.finding.severity} severity</span>
                <span
                  className={
                    isResolved ? styles.resolvedStatus : styles.openStatus
                  }
                >
                  {isResolved ? "Resolved" : "Open claim"}
                </span>
              </div>
              <h1
                ref={question}
                tabIndex={-1}
                id={`${id}-question`}
                className={styles.question}
              >
                {questions[review.active]}
              </h1>
              <p className={styles.claimCopy}>{review.finding.claim}</p>
            </section>

            <details
              className={styles.evidenceFold}
              key={review.finding.id}
              open
            >
              <summary className={styles.evidenceSummary}>
                <span>
                  <span className={styles.foldMark} aria-hidden="true">
                    ↳
                  </span>{" "}
                  The evidence
                </span>
                <span className={styles.foldHint}>
                  Source, suggested fix & private notes{" "}
                  <span className={styles.foldSymbol} aria-hidden="true">
                    ＋
                  </span>
                </span>
              </summary>
              <div className={styles.evidenceContent}>
                <section
                  className={styles.source}
                  aria-labelledby={`${id}-source`}
                >
                  <div className={styles.sourceHeader}>
                    <h2 id={`${id}-source`}>{review.finding.file}</h2>
                    <span>
                      Lines {review.finding.line}–
                      {review.finding.line + review.finding.evidence.length - 1}
                    </span>
                  </div>
                  <pre className={styles.code}>
                    <code>
                      {review.finding.evidence.map((line, index) => (
                        <span className={styles.codeLine} key={index}>
                          <span
                            className={styles.lineNumber}
                            aria-hidden="true"
                          >
                            {review.finding.line + index}
                          </span>
                          <span>{line}</span>
                        </span>
                      ))}
                    </code>
                  </pre>
                  <p className={styles.sourcePath}>{review.finding.path}</p>
                </section>
                <div className={styles.foldLower}>
                  <section className={styles.fix} aria-labelledby={`${id}-fix`}>
                    <h2 id={`${id}-fix`}>Suggested change</h2>
                    <p>{review.finding.fix}</p>
                    <p className={styles.fixAside}>
                      A review decision, not an automatic code change.
                    </p>
                  </section>
                  <section
                    className={styles.notes}
                    aria-labelledby={`${id}-notes`}
                  >
                    <h2 id={`${id}-notes`}>Your private notes</h2>
                    {savedNotes.length > 0 && (
                      <ul className={styles.savedNotes}>
                        {savedNotes.map((note, index) => (
                          <li key={index}>{note}</li>
                        ))}
                      </ul>
                    )}
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        review.saveNote();
                      }}
                    >
                      <label
                        className={styles.noteLabel}
                        htmlFor={`${id}-note`}
                      >
                        Add a note to this claim
                      </label>
                      <textarea
                        id={`${id}-note`}
                        name="private-note"
                        rows={3}
                        value={review.draft}
                        onChange={(event) =>
                          review.setDraft(event.target.value)
                        }
                        placeholder="What would you check before merging?"
                        aria-describedby={`${id}-note-privacy`}
                      />
                      <div className={styles.noteActions}>
                        <p id={`${id}-note-privacy`}>
                          Session only. Never published.
                        </p>
                        <button
                          className={styles.saveButton}
                          type="submit"
                          disabled={!review.draft.trim()}
                        >
                          Save note
                        </button>
                      </div>
                    </form>
                    <p className={styles.noteStatus} role="status">
                      {savedNotes.length > 0
                        ? `${savedNotes.length} private ${savedNotes.length === 1 ? "note" : "notes"} saved for this claim.`
                        : ""}
                    </p>
                  </section>
                </div>
              </div>
            </details>
          </div>

          <footer className={styles.decisionBar}>
            <div className={styles.decisionState} role="status">
              <span className={styles.resolvedCount}>
                {review.resolved.length} / {findings.length}
              </span>
              <span>
                {review.resolved.length === findings.length
                  ? "All claims resolved"
                  : "claims resolved"}
              </span>
            </div>
            <button
              className={styles.resolveButton}
              type="button"
              onClick={review.toggle}
            >
              {isResolved ? "Reopen claim" : "Mark resolved"}
              <span aria-hidden="true">{isResolved ? "↶" : "✓"}</span>
            </button>
            <nav className={styles.claimNav} aria-label="Navigate claims">
              <button
                type="button"
                className={styles.textButton}
                disabled={review.active === 0}
                onClick={() => review.select(review.active - 1)}
              >
                <span aria-hidden="true">←</span> Previous
              </button>
              <button
                type="button"
                className={styles.textButton}
                disabled={review.active === findings.length - 1}
                onClick={() => review.select(review.active + 1)}
              >
                Next claim <span aria-hidden="true">→</span>
              </button>
            </nav>
          </footer>
          <p className={styles.reviewDisclosure}>
            Illustrative local findings, not an analysis of the entered pull
            request. No network requests. No GitHub publishing.
          </p>
        </div>
      )}
    </main>
  );
}
