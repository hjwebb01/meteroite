"use client";

import { useId, useRef } from "react";
import { findings, sampleUrl, useSampleReview } from "../sample";
import s from "./current.module.css";

const excerpts = [
  {
    before: [
      "export async function applyDiscount(input: CheckoutInput) {",
      "  const now = Date.now();",
    ],
    after: ["  return total;", "}"],
    fix: [
      "if (discount.expiresAt < now) return subtotal;",
      "const total = subtotal - discount.amount;",
    ],
    label: "Expiry check",
  },
  {
    before: ["export async function createPayment(subtotal, discount) {"],
    after: ["}"],
    fix: [
      "const total = Math.max(0, subtotal - discount.amount);",
      "return payments.create({ amount: total });",
    ],
    label: "Payment amount",
  },
  {
    before: ["export async function findCode(input: DiscountInput) {"],
    after: ["}"],
    fix: [
      "const code = input.code.trim().toUpperCase();",
      "return db.codes.findUnique({ where: { code } });",
    ],
    label: "Code lookup",
  },
] as const;

function Syntax({ value }: { value: string }) {
  return value
    .split(/(\b(?:export|async|function|const|await|if|return)\b|\b\d+\b)/g)
    .map((part, index) => (
      <span
        key={index}
        className={
          /^(export|async|function|const|await|if|return)$/.test(part)
            ? s.keyword
            : /^\d+$/.test(part)
              ? s.number
              : undefined
        }
      >
        {part}
      </span>
    ));
}

function SourceRows({
  lines,
  start,
  marked = false,
}: {
  lines: readonly string[];
  start: number;
  marked?: boolean;
}) {
  return (
    <div className={s.sourceRows}>
      {lines.map((line, index) => (
        <div
          key={`${start}-${index}`}
          className={`${s.codeLine} ${marked ? s.markedLine : ""}`}
        >
          <span className={s.lineNumber} aria-hidden="true">
            {start + index}
          </span>
          <code>
            <Syntax value={line} />
          </code>
        </div>
      ))}
    </div>
  );
}

export function Current() {
  const r = useSampleReview();
  const id = useId();
  const sections = useRef<Array<HTMLElement | null>>([]);
  const title = useRef<HTMLHeadingElement>(null);
  const urlInput = useRef<HTMLInputElement>(null);

  function focusFinding(index: number) {
    r.select(index);
    const section = sections.current[index];
    section?.scrollIntoView({ block: "start", behavior: "instant" });
    section?.focus({ preventScroll: true });
  }

  function openSample(reference?: string) {
    r.start(reference);
    requestAnimationFrame(() => {
      if (title.current) {
        title.current.focus();
        title.current.scrollIntoView({ block: "start", behavior: "instant" });
      } else {
        urlInput.current?.focus();
      }
    });
  }

  return (
    <main className={`${s.canvas} ${r.reviewing ? s.reviewCanvas : ""}`}>
      <header className={s.masthead}>
        <span className={s.wordmark}>
          meteroite<span className={s.brandDivider}>/</span>
          <span>current</span>
        </span>
        <span className={s.localLabel}>
          <span aria-hidden="true">○</span> A local, private reading
        </span>
      </header>

      {!r.reviewing ? (
        <div className={s.landing}>
          <div className={s.intro}>
            <span className={s.kicker}>Follow the source</span>
            <h1>
              Read between
              <br />
              the lines.
            </h1>
            <p className={s.introCopy}>
              The change is the document. The evidence stays in it.
            </p>
            <p className={s.description}>
              Read the source, follow a finding, and leave a note that stays
              yours.
            </p>
            <form
              className={s.intake}
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                openSample();
              }}
            >
              <label htmlFor={`${id}-url`}>Start with a pull request</label>
              <input
                ref={urlInput}
                id={`${id}-url`}
                name="pull-request"
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                value={r.url}
                onChange={(event) => r.setUrl(event.target.value)}
                aria-invalid={Boolean(r.error)}
                aria-describedby={`${id}-help${r.error ? ` ${id}-error` : ""}`}
              />
              <button className={s.openButton} type="submit">
                Open local review <span aria-hidden="true">↗</span>
              </button>
              <p id={`${id}-help`} className={s.inputHelp}>
                URL for context only. No PR is fetched. All findings are
                illustrative.
              </p>
              {r.error && (
                <p className={s.error} id={`${id}-error`} role="alert">
                  {r.error}
                </p>
              )}
            </form>
            <button
              className={s.sampleButton}
              onClick={() => openSample(sampleUrl)}
            >
              Or read the sample <span aria-hidden="true">→</span>
            </button>
            <div className={s.introFoot}>
              <span>Private by default</span>
              <p>
                No GitHub writes.
                <br />
                Nothing posted for you.
              </p>
            </div>
          </div>

          <div
            className={s.landingFolio}
            aria-label="Illustrative source reading preview"
          >
            <div className={s.folioTitle}>
              <span>CHECKOUT / SOURCE FOLIO</span>
              <span>3 observations</span>
            </div>
            <div className={s.fileBand}>
              <span className={s.fileMark} aria-hidden="true">
                ↳
              </span>
              <strong>src/checkout/discounts.ts</strong>
              <span>EXCERPT 01</span>
            </div>
            <SourceRows lines={excerpts[0].before} start={40} />
            <SourceRows
              lines={findings[0].evidence.slice(0, 2)}
              start={42}
              marked
            />
            <button
              className={s.previewAnnotation}
              onClick={() => openSample(sampleUrl)}
            >
              <span className={s.annotationGutter} aria-hidden="true">
                ↳
              </span>
              <span className={s.previewCopy}>
                <span className={s.annotationEyebrow}>
                  An observation at line 44 <span>HIGH</span>
                </span>
                <strong>
                  The discount arrived.
                  <br />
                  The expiry check didn’t.
                </strong>
                <span>
                  The amount has already changed before this code asks whether
                  the discount is valid.
                </span>
                <span className={s.previewAction}>
                  Read the evidence <span aria-hidden="true">↗</span>
                </span>
              </span>
            </button>
            <SourceRows
              lines={findings[0].evidence.slice(2)}
              start={44}
              marked
            />
            <SourceRows lines={excerpts[0].after} start={45} />
            <div className={s.continuation}>
              <span aria-hidden="true">⋮</span>
              <span>The reading continues</span>
            </div>
            <div className={s.fileBand}>
              <span className={s.fileMark} aria-hidden="true">
                ↳
              </span>
              <strong>src/checkout/payment.ts</strong>
              <span>EXCERPT 02</span>
            </div>
            <SourceRows lines={excerpts[1].before} start={47} />
            <SourceRows lines={findings[1].evidence} start={48} marked />
            <div className={s.marginNote}>
              <span>↳</span>
              <p>
                A $25 discount. A $20 basket.
                <br />
                <strong>A payment below zero.</strong>
              </p>
            </div>
            <SourceRows lines={excerpts[1].after} start={50} />
            <div className={s.folioEnd}>
              <span>Source first. Conclusions second.</span>
              <span aria-hidden="true">↓</span>
            </div>
          </div>
        </div>
      ) : (
        <div className={s.review}>
          <header className={s.readingHeader}>
            <div>
              <span className={s.kicker}>Illustrative checkout change</span>
              <h1 ref={title} tabIndex={-1}>
                A closer reading.
              </h1>
              <p className={s.target}>{r.target}</p>
            </div>
            <div className={s.readingMeta}>
              <button
                className={s.backButton}
                onClick={() => {
                  r.setReviewing(false);
                  requestAnimationFrame(() => urlInput.current?.focus());
                }}
              >
                ← Return to intake
              </button>
              <p>No PR fetched · no GitHub writes</p>
            </div>
          </header>
          <nav className={s.navigator} aria-label="Source findings">
            <span className={s.navLabel}>In this reading</span>
            {findings.map((finding, index) => (
              <button
                key={finding.id}
                onClick={() => focusFinding(index)}
                aria-current={r.active === index ? "true" : undefined}
                aria-controls={`${id}-section-${index}`}
              >
                <span className={s.navNumber}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>
                  <strong>{excerpts[index].label}</strong>
                  <small>
                    {finding.file.split("/").at(-1)} · L{finding.line}
                  </small>
                </span>
                <span className={s.navStatus}>
                  {r.resolved.includes(index) ? "Resolved" : finding.severity}
                </span>
              </button>
            ))}
          </nav>
          <div className={s.document}>
            <div className={s.documentBand}>
              <span>THE SOURCE & ITS OBSERVATIONS</span>
              <span role="status">
                {findings.length - r.resolved.length} open · {r.resolved.length}{" "}
                resolved locally
              </span>
            </div>
            {findings.map((finding, index) => {
              const active = r.active === index;
              const resolved = r.resolved.includes(index);
              const excerpt = excerpts[index];
              return (
                <section
                  key={finding.id}
                  id={`${id}-section-${index}`}
                  ref={(element) => {
                    sections.current[index] = element;
                  }}
                  tabIndex={-1}
                  className={s.sourceSection}
                  aria-label={`${excerpt.label}, ${active ? "selected, " : ""}${resolved ? "resolved locally" : "open"}`}
                >
                  <div className={s.fileBand}>
                    <span className={s.fileMark} aria-hidden="true">
                      ↳
                    </span>
                    <strong>{finding.file}</strong>
                    <span>EXCERPT {String(index + 1).padStart(2, "0")}</span>
                  </div>
                  <SourceRows
                    lines={excerpt.before}
                    start={finding.line - excerpt.before.length}
                  />
                  <SourceRows
                    lines={finding.evidence}
                    start={finding.line}
                    marked
                  />
                  <div
                    className={`${s.annotation} ${active ? s.activeAnnotation : ""} ${resolved ? s.resolvedAnnotation : ""}`}
                  >
                    <div className={s.annotationGutter} aria-hidden="true">
                      {resolved ? "✓" : "↳"}
                    </div>
                    <div className={s.annotationBody}>
                      <div className={s.annotationEyebrow}>
                        <span>
                          Observation {String(index + 1).padStart(2, "0")} · L
                          {finding.line}
                        </span>
                        <span>
                          {resolved
                            ? "Resolved locally"
                            : `${finding.severity} priority`}
                          {active ? " · Selected" : ""}
                        </span>
                      </div>
                      {active ? (
                        <>
                          <h2>{finding.title}</h2>
                          <div className={s.claim}>
                            <span className={s.detailLabel}>
                              What the source says
                            </span>
                            <p>{finding.claim}</p>
                          </div>
                          <div className={s.fix}>
                            <span className={s.detailLabel}>
                              Suggested correction
                            </span>
                            <p>{finding.fix}</p>
                            <pre>
                              <code>
                                {excerpt.fix.map((line, lineIndex) => (
                                  <span className={s.fixLine} key={line}>
                                    <span
                                      className={s.fixPlus}
                                      aria-hidden="true"
                                    >
                                      +
                                    </span>
                                    <Syntax value={line} />
                                    {lineIndex < excerpt.fix.length - 1
                                      ? "\n"
                                      : ""}
                                  </span>
                                ))}
                              </code>
                            </pre>
                            {index === 2 && (
                              <small>
                                Use the same normalization when storing a code.
                              </small>
                            )}
                          </div>
                          <div className={s.localAction}>
                            <button onClick={r.toggle}>
                              {resolved
                                ? "Reopen finding"
                                : "Mark resolved locally"}
                              <span aria-hidden="true">
                                {resolved ? "↺" : "✓"}
                              </span>
                            </button>
                            <span>
                              This changes your reading, not the source.
                            </span>
                          </div>
                          <form
                            className={s.notes}
                            onSubmit={(event) => {
                              event.preventDefault();
                              r.saveNote();
                            }}
                          >
                            <div className={s.noteHeading}>
                              <label htmlFor={`${id}-note-${index}`}>
                                Your private margin
                              </label>
                              <span>{(r.notes[index] ?? []).length} saved</span>
                            </div>
                            <div
                              aria-live="polite"
                              aria-relevant="additions text"
                            >
                              {(r.notes[index] ?? []).map((note, noteIndex) => (
                                <p
                                  className={s.savedNote}
                                  key={`${index}-${noteIndex}`}
                                >
                                  <span aria-hidden="true">↳</span>
                                  {note}
                                </p>
                              ))}
                            </div>
                            <textarea
                              id={`${id}-note-${index}`}
                              rows={2}
                              value={r.draft}
                              onChange={(event) =>
                                r.setDraft(event.target.value)
                              }
                              placeholder="Leave a thought beside the evidence…"
                              aria-describedby={`${id}-note-help-${index}`}
                            />
                            <div className={s.noteFooter}>
                              <p id={`${id}-note-help-${index}`}>
                                Kept in this review session. Never posted.
                              </p>
                              <button type="submit" disabled={!r.draft.trim()}>
                                Save private note{" "}
                                <span aria-hidden="true">↗</span>
                              </button>
                            </div>
                          </form>
                        </>
                      ) : (
                        <button
                          className={s.collapsedAnnotation}
                          onClick={() => focusFinding(index)}
                          aria-expanded={false}
                        >
                          <h2>{finding.title}</h2>
                          <span>
                            Read observation
                            {(r.notes[index] ?? []).length > 0
                              ? ` · ${r.notes[index].length} private notes`
                              : ""}
                            <span aria-hidden="true">↗</span>
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                  <SourceRows
                    lines={excerpt.after}
                    start={finding.line + finding.evidence.length}
                  />
                  {index < findings.length - 1 && (
                    <div className={s.continuation}>
                      <span aria-hidden="true">⋮</span>
                      <span>Next source excerpt</span>
                    </div>
                  )}
                </section>
              );
            })}
            <footer className={s.readingEnd}>
              <span aria-hidden="true">↓</span>
              <div>
                <strong>End of the source. Not the conversation.</strong>
                <p>
                  Your notes and resolved states stay here as you move between
                  findings. Starting another review resets this local sample.
                </p>
              </div>
              <button onClick={() => focusFinding(0)}>
                Back to the first finding ↑
              </button>
            </footer>
          </div>
        </div>
      )}
      <footer className={s.pageFooter}>
        <span>METEROITE / CURRENT</span>
        <span>Illustrative source · private evidence · your judgment</span>
      </footer>
    </main>
  );
}
