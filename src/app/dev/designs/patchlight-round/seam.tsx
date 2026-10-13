"use client";

import { useId, useState } from "react";
import { findings, sampleUrl, useSampleReview } from "../sample";
import styles from "./seam.module.css";

const corrections = {
  expiry: {
    title: "Check expiry first.",
    lines: [
      "const discount = await findCode(input.code);",
      "if (discount.expiresAt < now) return subtotal;",
      "const total = subtotal - discount.amount;",
      "return total;",
    ],
    changed: 1,
    risk: 2,
    test: "An expired $10 code on a $40 basket must leave the total at $40.",
    detail:
      "Move the expiry guard ahead of the calculation. Returning the subtotal means an expired code never changes the amount charged.",
  },
  total: {
    title: "Put a floor on the total.",
    lines: [
      "const total = Math.max(0, subtotal - discount.amount);",
      "return payments.create({ amount: total });",
    ],
    changed: 0,
    risk: 0,
    test: "A $25 discount on a $20 basket must create a $0 payment, not −$5.",
    detail:
      "Clamp the amount before handing it to the payment provider. The proposed change leaves ordinary discounts intact and prevents a negative charge.",
  },
  case: {
    title: "Match the stored format.",
    lines: [
      "const code = input.code.trim().toUpperCase();",
      "return db.codes.findUnique({ where: { code } });",
    ],
    changed: 0,
    risk: 0,
    test: "welcome10 and WELCOME10 must find the same stored WELCOME10 code.",
    detail:
      "Normalize customer input to uppercase before the exact-match lookup. This sample stores codes in uppercase; code creation must use the same convention.",
  },
} as const;

function Comparison({ finding }: { finding: (typeof findings)[number] }) {
  const sourceId = useId();
  const proposedId = useId();
  const correction = corrections[finding.id];
  return (
    <div className={styles.comparison}>
      <section className={styles.sourcePanel} aria-labelledby={sourceId}>
        <div className={styles.panelHeader}>
          <h3 id={sourceId}>
            <span className={styles.riskDot} />
            Current source
          </h3>
          <span>Sample evidence</span>
        </div>
        <div className={styles.filePath}>
          {finding.file}
          <span>
            L{finding.line}–{finding.line + finding.evidence.length - 1}
          </span>
        </div>
        <pre className={styles.code}>
          <code>
            {finding.evidence.map((line, index) => (
              <span
                className={`${styles.codeLine} ${index === correction.risk ? styles.riskyLine : ""}`}
                key={line}
              >
                <span className={styles.lineNumber} aria-hidden="true">
                  {finding.line + index}
                </span>
                <span className={styles.lineText}>{line}</span>
              </span>
            ))}
          </code>
        </pre>
        <div className={styles.panelFooter}>
          <span className={styles.minus}>−</span> The behavior to question
        </div>
      </section>
      <div className={styles.seam}>
        <span className={styles.seamLabel}>The difference</span>
        <div className={styles.bridge}>
          <span aria-hidden="true">→</span>
        </div>
        <p>{correction.title}</p>
      </div>
      <section className={styles.proposedPanel} aria-labelledby={proposedId}>
        <div className={styles.panelHeader}>
          <h3 id={proposedId}>
            <span className={styles.fixDot} />
            Proposed correction
          </h3>
          <span>Hypothetical · not applied</span>
        </div>
        <div className={styles.filePath}>
          {finding.file}
          <span>Illustrative edit</span>
        </div>
        <pre className={styles.code}>
          <code>
            {correction.lines.map((line, index) => (
              <span
                className={`${styles.codeLine} ${index === correction.changed ? styles.correctedLine : ""}`}
                key={line}
              >
                <span className={styles.lineNumber} aria-hidden="true">
                  {index === correction.changed ? "+" : "·"}
                </span>
                <span className={styles.lineText}>{line}</span>
              </span>
            ))}
          </code>
        </pre>
        <div className={styles.panelFooter}>
          <span className={styles.plus}>+</span> A change to consider, not a
          write to GitHub
        </div>
      </section>
    </div>
  );
}

export function Seam() {
  const review = useSampleReview();
  const urlId = useId();
  const errorId = useId();
  const noteId = useId();
  const [noteNotice, setNoteNotice] = useState("");
  const resolved = review.resolved.includes(review.active);
  const correction = corrections[review.finding.id];
  const notes = review.notes[review.active] ?? [];

  return (
    <section className={styles.root} aria-label="Seam private review prototype">
      <header className={styles.masthead}>
        <div className={styles.wordmark}>
          <span aria-hidden="true">⫶</span> seam
          <span className={styles.wordmarkDetail}>by Patchlight</span>
        </div>
        <span className={styles.privateLabel}>
          <span aria-hidden="true">↳</span> Evidence first. Yours alone.
        </span>
      </header>
      {!review.reviewing ? (
        <>
          <div className={styles.introduction}>
            <p className={styles.eyebrow}>
              A private second look at your pull request
            </p>
            <h1>
              See the
              <br className={styles.mobileBreak} /> difference.
            </h1>
            <div className={styles.heroCaption}>
              <p>
                Good reviews connect a concern to the code.
                <br />
                Great ones make the next move clear.
              </p>
              <span>Source → reason → possible fix</span>
            </div>
          </div>
          <Comparison finding={findings[0]} />
          <form
            className={styles.intake}
            onSubmit={(event) => {
              event.preventDefault();
              setNoteNotice("");
              review.start();
            }}
          >
            <label htmlFor={urlId}>
              Bring a pull request<span>GitHub URL</span>
            </label>
            <div className={styles.urlField}>
              <span aria-hidden="true">↗</span>
              <input
                id={urlId}
                type="url"
                value={review.url}
                onChange={(event) => review.setUrl(event.target.value)}
                placeholder="https://github.com/owner/repo/pull/123"
                required
                aria-invalid={Boolean(review.error)}
                aria-describedby={errorId}
              />
            </div>
            <button className={styles.primaryButton} type="submit">
              Open local preview <span aria-hidden="true">→</span>
            </button>
            <button
              className={styles.sampleButton}
              type="button"
              onClick={() => {
                setNoteNotice("");
                review.start(sampleUrl);
              }}
            >
              Or try the sample
            </button>
          </form>
          <p
            id={errorId}
            className={review.error ? styles.error : styles.intakeHint}
            role={review.error ? "alert" : undefined}
          >
            {review.error ||
              "This prototype validates the URL, then opens three illustrative findings. No PR is fetched and nothing is written to GitHub."}
          </p>
          <div className={styles.landingFooter}>
            <div>
              <span>Read the source.</span>
              <p>Actual sample lines beside each concern.</p>
            </div>
            <div>
              <span>Weigh the correction.</span>
              <p>A proposed edit, never an automatic one.</p>
            </div>
            <div>
              <span>Keep your own counsel.</span>
              <p>Private notes and local resolution states.</p>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className={styles.reviewTop}>
            <button
              className={styles.backButton}
              type="button"
              onClick={() => {
                setNoteNotice("");
                review.setReviewing(false);
              }}
            >
              ← Return to intake
            </button>
            <span>Local sample · no PR fetched · no GitHub writes</span>
          </div>
          <div className={styles.reviewHeading}>
            <div>
              <p className={styles.eyebrow}>Reference: {review.target}</p>
              <h1>Between the lines.</h1>
            </div>
            <p className={styles.progress}>
              <strong>
                {review.resolved.length}
                <span> / 3</span>
              </strong>
              resolved locally
            </p>
          </div>
          <nav className={styles.findingSelector} aria-label="Sample findings">
            {findings.map((finding, index) => (
              <button
                key={finding.id}
                type="button"
                aria-pressed={review.active === index}
                className={`${styles.findingButton} ${review.active === index ? styles.selectedFinding : ""}`}
                onClick={() => {
                  setNoteNotice("");
                  review.select(index);
                }}
              >
                <span className={styles.findingNumber}>
                  {review.resolved.includes(index) ? "✓" : `0${index + 1}`}
                </span>
                <span>
                  <strong>
                    {index === 0
                      ? "Expired codes"
                      : index === 1
                        ? "Negative totals"
                        : "Lowercase lookup"}
                  </strong>
                  <small>
                    {finding.severity} · L{finding.line}
                    {review.resolved.includes(index) ? " · Resolved" : ""}
                  </small>
                </span>
                <span className={styles.selectorArrow} aria-hidden="true">
                  ↗
                </span>
              </button>
            ))}
          </nav>
          <div className={styles.findingHeading}>
            <h2>{review.finding.title}</h2>
            <span
              className={`${styles.severity} ${review.finding.severity === "High" ? styles.highSeverity : ""}`}
            >
              {review.finding.severity} severity
            </span>
          </div>
          <Comparison finding={review.finding} />
          <div className={styles.reasoning}>
            <section
              className={styles.reasonColumn}
              aria-label="Finding reasoning"
            >
              <p className={styles.eyebrow}>Why this matters</p>
              <p className={styles.claim}>{review.finding.claim}</p>
              <p className={styles.flow}>{review.finding.path}</p>
              <div className={styles.fixReason}>
                <h3>{review.finding.fix}</h3>
                <p>{correction.detail}</p>
              </div>
              <div className={styles.testCase}>
                <span>Check the correction</span>
                <p>{correction.test}</p>
              </div>
              <div className={styles.resolveRow}>
                <button
                  className={
                    resolved ? styles.reopenButton : styles.primaryButton
                  }
                  type="button"
                  onClick={review.toggle}
                >
                  {resolved ? "Reopen finding" : "Mark resolved locally"}
                  <span aria-hidden="true">{resolved ? "↶" : "✓"}</span>
                </button>
                <span aria-live="polite">
                  {resolved
                    ? "Resolved here. No code was changed."
                    : "Your review state only. No code changes."}
                </span>
              </div>
            </section>
            <section
              className={styles.notesColumn}
              aria-label="Private finding notes"
            >
              <div className={styles.noteHeading}>
                <h3>A note to yourself.</h3>
                <span>Private · this session</span>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  review.saveNote();
                  setNoteNotice("Private note saved in this session.");
                }}
              >
                <label htmlFor={noteId}>
                  Your reasoning, questions, or next steps
                </label>
                <textarea
                  id={noteId}
                  value={review.draft}
                  onChange={(event) => review.setDraft(event.target.value)}
                  placeholder="What would you check before accepting this change?"
                  rows={4}
                />
                <div className={styles.noteActions}>
                  <span>Never posted to the pull request</span>
                  <button type="submit" disabled={!review.draft.trim()}>
                    Save private note <span aria-hidden="true">↗</span>
                  </button>
                </div>
              </form>
              <p className={styles.noteNotice} role="status">
                {noteNotice}
              </p>
              {notes.length > 0 ? (
                <ul className={styles.noteList}>
                  {notes.map((note, index) => (
                    <li key={`${review.active}-${index}`}>
                      <span>Saved note {index + 1}</span>
                      <p>{note}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.emptyNotes}>
                  No notes on this finding yet. Saved notes stay here when you
                  switch findings; a new preview resets the session.
                </p>
              )}
            </section>
          </div>
          <footer className={styles.reviewFooter}>
            <span>Three sample concerns. One private review.</span>
            <span>
              Proposed corrections are hypothetical and have not been applied.
            </span>
          </footer>
        </>
      )}
    </section>
  );
}
