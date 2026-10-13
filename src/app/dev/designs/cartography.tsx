"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { findings, sampleUrl, useSampleReview } from "./sample";
import styles from "./cartography.module.css";

const stations = [
  {
    name: "Customer input",
    caption: "A code enters the checkout",
    issue: "Case sensitivity",
    finding: 2,
    position: "input",
  },
  {
    name: "Code lookup",
    caption: "Find the matching offer",
    issue: "Expired codes",
    finding: 0,
    position: "lookup",
  },
  {
    name: "Discount calculation",
    caption: "Adjust the basket total",
    issue: "Unbounded discount",
    finding: 1,
    position: "discount",
  },
  {
    name: "Payment",
    caption: "Create the final charge",
    issue: "Negative payment",
    finding: 1,
    position: "payment",
  },
] as const;
const impactedStations = [
  [1, 2, 3],
  [2, 3],
  [0, 1],
];

export function Cartography() {
  const review = useSampleReview();
  const id = useId();
  const [noteSaved, setNoteSaved] = useState(false);
  const isResolved = review.resolved.includes(review.active);
  const selectedPath =
    review.active === 2
      ? styles.inputPath
      : review.active === 0
        ? styles.expiryPath
        : styles.paymentPath;

  function visitFinding(index: number) {
    if (!review.reviewing) {
      review.start(sampleUrl);
    }
    review.select(index);
    setNoteSaved(false);
  }

  return (
    <main className={styles.atlas}>
      <header className={styles.header}>
        <Link className={styles.wordmark} href="/" aria-label="Meteroite home">
          <svg viewBox="0 0 28 28" aria-hidden="true">
            <path d="M4 19 13 4l11 17-10-5-10 3Z" />
            <path d="m4 19 10-3-1-12" />
          </svg>
          meteroite
        </Link>
        <span className={styles.edition}>
          Change-impact atlas <span>Experimental design</span>
        </span>
        <span className={styles.localBadge}>
          <i aria-hidden="true" /> Local sample
        </span>
      </header>

      <section
        className={styles.introduction}
        aria-labelledby={`${id}-atlas-title`}
      >
        <div>
          <p className={styles.eyebrow}>
            {review.reviewing
              ? "Checkout / inspection in progress"
              : "Private pull request review"}
          </p>
          <h1 id={`${id}-atlas-title`}>
            {review.reviewing ? "Trace the impact." : "Follow the change."}
          </h1>
          <p className={styles.lead}>
            {review.reviewing
              ? "A change in one place can travel. Follow the path, then inspect the evidence."
              : "Not just what changed. Where it leads. Explore a checkout change from customer input to the final charge."}
          </p>
        </div>
        <div className={styles.edgeRail}>
          {review.reviewing ? (
            <>
              <span className={styles.railLabel}>Your inspection</span>
              <p>
                <strong>{findings.length - review.resolved.length}</strong> open
                findings in this sample
              </p>
              <button
                className={styles.backButton}
                onClick={() => {
                  review.setReviewing(false);
                  setNoteSaved(false);
                }}
              >
                ← Return to intake
              </button>
            </>
          ) : (
            <>
              <span className={styles.railLabel}>Read the route</span>
              <p>
                Choose a station to open the sample review. Each stop reveals a
                different part of the change.
              </p>
              <span className={styles.railHint}>
                Four stations. One checkout.
              </span>
            </>
          )}
        </div>
      </section>

      <section
        className={`${styles.mapSection} ${review.reviewing ? styles.reviewMap : ""}`}
        aria-labelledby={`${id}-map-title`}
      >
        <div className={styles.mapHeading}>
          <h2 id={`${id}-map-title`}>Checkout flow</h2>
          <span>
            {review.reviewing
              ? "Select a station to inspect"
              : "Interactive sample map"}
          </span>
        </div>
        <div className={styles.map}>
          <svg
            className={styles.connections}
            viewBox="0 0 1000 330"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              className={styles.terrain}
              d="M35 230C55 120 170 84 260 110S407 42 520 73s109 94 220 64 206-45 228 72-30 112-140 100-152-42-249-2-142-64-248-23S13 298 35 230Z"
            />
            <path
              className={styles.basePath}
              d="M125 232C218 232 207 94 350 94C458 94 458 198 623 198C766 198 766 72 875 72"
            />
            {review.reviewing && (
              <path
                className={`${styles.activePath} ${selectedPath} ${isResolved ? styles.resolvedPath : ""}`}
                d={
                  review.active === 2
                    ? "M125 232C218 232 207 94 350 94"
                    : review.active === 0
                      ? "M350 94C458 94 458 198 623 198C766 198 766 72 875 72"
                      : "M623 198C766 198 766 72 875 72"
                }
              />
            )}
          </svg>
          <svg
            className={styles.mobileConnections}
            viewBox="0 0 340 650"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              className={styles.terrain}
              d="M60 25C136-15 295 104 304 207s-181 82-216 174 199 108 209 177-139 106-189 30S12 429 41 332 15 119 60 25Z"
            />
            <path
              className={styles.basePath}
              d="M95 42C95 123 245 123 245 198C245 280 95 280 95 362C95 444 245 444 245 526"
            />
            {review.reviewing && (
              <path
                className={`${styles.activePath} ${selectedPath} ${isResolved ? styles.resolvedPath : ""}`}
                d={
                  review.active === 2
                    ? "M95 42C95 123 245 123 245 198"
                    : review.active === 0
                      ? "M245 198C245 280 95 280 95 362C95 444 245 444 245 526"
                      : "M95 362C95 444 245 444 245 526"
                }
              />
            )}
          </svg>
          <span className={styles.routeAnnotation} aria-hidden="true">
            The path from code to charge
          </span>
          {stations.map((station, index) => {
            const impacted =
              review.reviewing &&
              impactedStations[review.active].includes(index);
            const selected =
              review.reviewing &&
              (review.active === 2
                ? index === 0
                : review.active === 0
                  ? index === 1
                  : index === 3);
            return (
              <button
                key={station.name}
                className={`${styles.station} ${styles[station.position]} ${impacted ? styles.impacted : ""} ${selected ? styles.selected : ""} ${impacted && isResolved ? styles.resolvedStation : ""}`}
                onClick={() => visitFinding(station.finding)}
                aria-label={`${station.name}: inspect ${station.issue.toLowerCase()}`}
                aria-pressed={selected}
              >
                <span className={styles.stationPoint} aria-hidden="true">
                  <span />
                </span>
                <span className={styles.stationName}>{station.name}</span>
                <span className={styles.stationCaption}>{station.caption}</span>
                <span className={styles.stationIssue}>
                  {station.issue}
                  <span aria-hidden="true"> ↗</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className={styles.mapLegend}>
          <span>
            <i className={styles.legendRoute} aria-hidden="true" /> Checkout
            route
          </span>
          <span>
            <i className={styles.legendIssue} aria-hidden="true" />{" "}
            {review.reviewing && isResolved
              ? "Resolved impact path"
              : "Finding location"}
          </span>
          <span className={styles.mapScope}>
            Sample: discount-code checkout
          </span>
        </div>
      </section>

      {review.reviewing ? (
        <section className={styles.inspection} aria-label="Finding inspection">
          <nav className={styles.findingIndex} aria-label="Sample findings">
            <span className={styles.eyebrow}>Field notes</span>
            {findings.map((finding, index) => (
              <button
                key={finding.id}
                className={review.active === index ? styles.activeFinding : ""}
                aria-pressed={review.active === index}
                onClick={() => visitFinding(index)}
              >
                <span className={styles.findingMarker} aria-hidden="true">
                  {review.resolved.includes(index) ? "✓" : index + 1}
                </span>
                <span>
                  {finding.title}
                  <small>
                    {finding.severity} severity ·{" "}
                    {review.resolved.includes(index) ? "Resolved" : "Open"}
                  </small>
                </span>
              </button>
            ))}
          </nav>

          <article
            className={styles.findingDetail}
            aria-labelledby={`${id}-finding-title`}
          >
            <div className={styles.detailTop}>
              <span className={styles.eyebrow}>
                Impact / {review.active + 1} of {findings.length}
              </span>
              <span
                className={isResolved ? styles.resolvedLabel : styles.severity}
              >
                {isResolved
                  ? "Resolved"
                  : `${review.finding.severity} severity`}
              </span>
            </div>
            <h2 id={`${id}-finding-title`}>{review.finding.title}</h2>
            <p className={styles.claim}>{review.finding.claim}</p>
            <div className={styles.impactRoute}>
              <span>Impacted path</span>
              <p>{review.finding.path}</p>
            </div>
            <div className={styles.sourceHeading}>
              <h3>Source evidence</h3>
              <span>
                {review.finding.file}:{review.finding.line}
              </span>
            </div>
            <pre className={styles.source}>
              <code>
                {review.finding.evidence.map((line, index) => (
                  <span className={styles.sourceLine} key={line}>
                    <span className={styles.lineNumber} aria-hidden="true">
                      {review.finding.line + index}
                    </span>
                    <span>{line}</span>
                  </span>
                ))}
              </code>
            </pre>
            <div className={styles.fix}>
              <span className={styles.eyebrow}>Suggested correction</span>
              <p>{review.finding.fix}</p>
            </div>
            <button className={styles.resolveButton} onClick={review.toggle}>
              {isResolved ? "Reopen finding" : "Mark as resolved"}
              <span aria-hidden="true">{isResolved ? "↺" : "✓"}</span>
            </button>
          </article>

          <aside className={styles.notes} aria-labelledby={`${id}-notes-title`}>
            <span className={styles.noteSymbol} aria-hidden="true">
              ✳
            </span>
            <h2 id={`${id}-notes-title`}>A private margin.</h2>
            <p>
              Keep your reasoning beside this finding. Notes stay in this page
              session.
            </p>
            {(review.notes[review.active] ?? []).length > 0 && (
              <ol className={styles.savedNotes}>
                {review.notes[review.active].map((note, index) => (
                  <li key={index}>
                    <span>Note {index + 1}</span>
                    <p>{note}</p>
                  </li>
                ))}
              </ol>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (review.draft.trim()) {
                  review.saveNote();
                  setNoteSaved(true);
                }
              }}
            >
              <label htmlFor={`${id}-note`}>Note for this finding</label>
              <textarea
                id={`${id}-note`}
                value={review.draft}
                onChange={(event) => {
                  review.setDraft(event.target.value);
                  setNoteSaved(false);
                }}
                placeholder="What should the author consider?"
                rows={4}
              />
              <button
                className={styles.noteButton}
                disabled={!review.draft.trim()}
                type="submit"
              >
                Save private note <span aria-hidden="true">↗</span>
              </button>
            </form>
            <p className={styles.noteStatus} role="status">
              {noteSaved
                ? "Private note saved in this session."
                : "Nothing is published to GitHub."}
            </p>
          </aside>
        </section>
      ) : (
        <section
          className={styles.intakeSection}
          aria-labelledby={`${id}-intake-title`}
        >
          <div className={styles.intake}>
            <span className={styles.eyebrow}>Start with a reference</span>
            <h2 id={`${id}-intake-title`}>Bring a pull request.</h2>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                review.start();
                setNoteSaved(false);
              }}
            >
              <label htmlFor={`${id}-url`}>GitHub pull request URL</label>
              <div className={styles.urlControl}>
                <input
                  id={`${id}-url`}
                  type="text"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  value={review.url}
                  onChange={(event) => review.setUrl(event.target.value)}
                  aria-invalid={Boolean(review.error)}
                  aria-describedby={
                    review.error ? `${id}-url-error ${id}-scope` : `${id}-scope`
                  }
                />
                <button type="submit">
                  Open sample <span aria-hidden="true">→</span>
                </button>
              </div>
              {review.error && (
                <p id={`${id}-url-error`} className={styles.error} role="alert">
                  {review.error}
                </p>
              )}
            </form>
            <p id={`${id}-scope`} className={styles.scope}>
              The URL is a reference only. This experiment opens local sample
              findings; it does not fetch your pull request.
            </p>
          </div>
          <div className={styles.intakeAside}>
            <span className={styles.asideRule} aria-hidden="true" />
            <h3>Evidence before opinion.</h3>
            <p>
              Inspect the lines. Follow the consequence. Leave a private note,
              or mark a finding resolved when you are satisfied.
            </p>
          </div>
        </section>
      )}

      <footer className={styles.footer}>
        <span>Development-only design experiment · Local sample data</span>
        <span>No network requests. No GitHub publishing.</span>
        {review.reviewing && (
          <span className={styles.reference}>Reference: {review.url}</span>
        )}
      </footer>
    </main>
  );
}
