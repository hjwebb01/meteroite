"use client";

import { useEffect, useId, useRef, useState } from "react";
import styles from "./sample-review.module.css";

interface SampleLine {
  oldLine: number | null;
  newLine: number | null;
  kind: "context" | "added" | "removed";
  text: string;
}

interface SampleSection {
  id: string;
  title: string;
  purpose: string;
  file: string;
  location: string;
  findingCount: number;
  lines: SampleLine[];
}

const sections: SampleSection[] = [
  {
    id: "calculation",
    title: "Calculate the discounted total",
    purpose:
      "Applies a fixed discount to the subtotal. Start here: this is the amount that reaches payment.",
    file: "src/checkout/total.ts",
    location: "new 18–25",
    findingCount: 1,
    lines: [
      {
        oldLine: 18,
        newLine: 18,
        kind: "context",
        text: "export function total(subtotal: number, discount: number) {",
      },
      {
        oldLine: 19,
        newLine: null,
        kind: "removed",
        text: "  return subtotal;",
      },
      {
        oldLine: null,
        newLine: 19,
        kind: "added",
        text: "  const amount = Math.max(0, discount);",
      },
      {
        oldLine: null,
        newLine: 20,
        kind: "added",
        text: "  if (amount === 0) {",
      },
      {
        oldLine: null,
        newLine: 21,
        kind: "added",
        text: "    return subtotal;",
      },
      { oldLine: null, newLine: 22, kind: "added", text: "  }" },
      { oldLine: null, newLine: 23, kind: "added", text: "" },
      {
        oldLine: null,
        newLine: 24,
        kind: "added",
        text: "  return subtotal - amount;",
      },
      { oldLine: 20, newLine: 25, kind: "context", text: "}" },
    ],
  },
  {
    id: "input",
    title: "Accept a code at checkout",
    purpose:
      "Trims the entered code before looking up its discount. This is the input path into the total.",
    file: "src/checkout/discount-code.ts",
    location: "new 7–11",
    findingCount: 0,
    lines: [
      {
        oldLine: 7,
        newLine: 7,
        kind: "context",
        text: "export function discountFor(input: string) {",
      },
      {
        oldLine: 8,
        newLine: null,
        kind: "removed",
        text: "  return discounts.get(input);",
      },
      {
        oldLine: null,
        newLine: 8,
        kind: "added",
        text: "  const code = input.trim();",
      },
      {
        oldLine: null,
        newLine: 9,
        kind: "added",
        text: "  if (!code) return 0;",
      },
      {
        oldLine: null,
        newLine: 10,
        kind: "added",
        text: "  return discounts.get(code) ?? 0;",
      },
      { oldLine: 9, newLine: 11, kind: "context", text: "}" },
    ],
  },
];

/** The landing's live fragment: choose a purpose and the brief folds into a spine beside its source. */
export function SampleReview() {
  const id = useId();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [readIds, setReadIds] = useState<string[]>([]);
  const sourceHeading = useRef<HTMLHeadingElement>(null);
  const sectionButtons = useRef<Map<string, HTMLButtonElement>>(new Map());
  const lastSectionId = useRef<string | null>(null);
  const selected =
    sections.find((section) => section.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedId) {
      sourceHeading.current?.focus();
    } else if (lastSectionId.current) {
      sectionButtons.current.get(lastSectionId.current)?.focus();
    }
  }, [selectedId]);

  function openSection(sectionId: string) {
    lastSectionId.current = sectionId;
    setSelectedId(sectionId);
  }

  function toggleRead(sectionId: string) {
    setReadIds((current) =>
      current.includes(sectionId)
        ? current.filter((item) => item !== sectionId)
        : [...current, sectionId],
    );
  }

  function registerButton(sectionId: string, node: HTMLButtonElement | null) {
    if (node) sectionButtons.current.set(sectionId, node);
    else sectionButtons.current.delete(sectionId);
  }

  return (
    <section className={styles.sample} aria-labelledby={`${id}-title`}>
      <header className={styles.bar}>
        <div className={styles.barTitle}>
          <h2 id={`${id}-title`}>Add discount codes at checkout</h2>
          <p>
            Sample PR · revision <code>8c21e4a</code> · 2 files
          </p>
        </div>
        <p className={styles.barCount}>
          {readIds.length} of {sections.length} read
        </p>
      </header>

      {!selected && (
        <div className={styles.brief}>
          <div className={styles.briefIntro}>
            <p className={styles.briefLabel}>
              Generated brief · illustrative, not live model output
            </p>
            <p className={styles.orientation}>
              A checkout code now changes the payment total. Open a purpose to
              read its exact diff.
            </p>
          </div>
          <ul className={styles.sections} aria-label="Sample purpose sections">
            {sections.map((section) => {
              const read = readIds.includes(section.id);
              return (
                <li key={section.id} className={styles.purpose}>
                  <button
                    ref={(node) => registerButton(section.id, node)}
                    type="button"
                    className={styles.purposeButton}
                    aria-controls={`${id}-source`}
                    aria-expanded={false}
                    onClick={() => openSection(section.id)}
                  >
                    <span className={styles.purposeTitle}>{section.title}</span>
                    <span className={styles.purposeDescription}>
                      {section.purpose}
                    </span>
                    <span className={styles.grounding}>
                      <code>{section.file}</code> · {section.location} ·{" "}
                      {section.findingCount === 1 ? "1 finding" : "no findings"}
                    </span>
                  </button>
                  <button
                    className={styles.readButton}
                    type="button"
                    aria-pressed={read}
                    onClick={() => toggleRead(section.id)}
                  >
                    {read ? "Read" : "Mark read"}
                    <span className="sr-only">: {section.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className={styles.note}>
            Ungrouped: 0 hunks · All changes (2 files). Read marks stay in this
            visit and never approve the change.
          </p>
        </div>
      )}

      <div className={selected ? styles.reading : undefined} hidden={!selected}>
        {selected && (
          <nav className={styles.spine} aria-label="Context spine">
            <button
              type="button"
              className={styles.back}
              onClick={() => setSelectedId(null)}
            >
              ← Back to brief
            </button>
            <p className={styles.spineLabel}>Generated brief</p>
            {sections.map((section) => {
              const active = section.id === selected.id;
              const read = readIds.includes(section.id);
              return (
                <button
                  key={section.id}
                  ref={(node) => registerButton(section.id, node)}
                  type="button"
                  className={styles.spineItem}
                  aria-current={active ? "true" : undefined}
                  onClick={() => openSection(section.id)}
                >
                  <span className={styles.spineTitle}>{section.title}</span>
                  <span className={styles.spineState}>
                    {active ? "Reading" : read ? "Read" : "Unread"} ·{" "}
                    {section.findingCount === 1 ? "1 finding" : "no findings"}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              className={styles.spineRead}
              aria-pressed={readIds.includes(selected.id)}
              onClick={() => toggleRead(selected.id)}
            >
              {readIds.includes(selected.id) ? "Read · undo" : "Mark read"}
            </button>
          </nav>
        )}

        <section
          id={`${id}-source`}
          className={styles.source}
          aria-labelledby={`${id}-source-title`}
        >
          {selected && (
            <>
              <div className={styles.sourceHeader}>
                <h3
                  ref={sourceHeading}
                  id={`${id}-source-title`}
                  tabIndex={-1}
                >
                  <code>{selected.file}</code>
                </h3>
                <p>{selected.location} · unified</p>
              </div>
              <div
                className={styles.diff}
                role="region"
                aria-label={`${selected.file} sample diff`}
                tabIndex={0}
              >
                {selected.lines.map((line, index) => (
                  <div key={`${selected.id}-${index}`}>
                    <div className={styles.line} data-kind={line.kind}>
                      <span
                        className={styles.lineNumber}
                        aria-label={
                          line.oldLine === null
                            ? "No old line"
                            : `Old line ${line.oldLine}`
                        }
                      >
                        {line.oldLine ?? ""}
                      </span>
                      <span
                        className={styles.lineNumber}
                        aria-label={
                          line.newLine === null
                            ? "No new line"
                            : `New line ${line.newLine}`
                        }
                      >
                        {line.newLine ?? ""}
                      </span>
                      <span className={styles.lineKind} aria-label={line.kind}>
                        {line.kind === "added"
                          ? "+"
                          : line.kind === "removed"
                            ? "−"
                            : " "}
                      </span>
                      <code>{line.text || " "}</code>
                    </div>
                    {selected.id === "calculation" && line.newLine === 24 && (
                      <div className={styles.finding}>
                        <p className={styles.severity}>
                          High · new line 24 · 8c21e4a
                        </p>
                        <h4>The total can go below zero</h4>
                        <p>
                          When the discount is larger than the subtotal, line
                          24 returns a negative amount, and that amount reaches
                          payment.
                        </p>
                        <p className={styles.findingMeta}>
                          Evidence: total.ts new 19 and 24 · Suggested fix:
                          clamp with <code>Math.max(0, …)</code>
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {selected.findingCount === 0 && (
                <p className={styles.noFindings}>
                  No finding in this section. That is not a claim that the code
                  is safe.
                </p>
              )}
            </>
          )}
        </section>
      </div>
      <p className="sr-only" role="status">
        {readIds.length > 0
          ? `${readIds.length} of ${sections.length} sample sections marked read in this visit. This does not approve the change.`
          : "Both sample sections are unread."}
      </p>
    </section>
  );
}
