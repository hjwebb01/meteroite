"use client";

import { useId, useState } from "react";
import styles from "./landing.module.css";

const findings = [
  {
    id: "negative-total",
    label: "Include: total below zero",
    body: "High · The total can go below zero (src/checkout/total.ts, new line 24)",
    target: "src/checkout/total.ts · new 24",
    inline:
      "When the discount is larger than the subtotal this returns a negative amount, which reaches payment. Clamp the result at zero.",
  },
  {
    id: "case-sensitive",
    label: "Include: case-sensitive codes",
    body: "Low · Codes match case-sensitively (src/checkout/discount-code.ts, new line 10)",
    target: "src/checkout/discount-code.ts · new 10",
    inline:
      "A shopper typing save10 will not match SAVE10. Worth confirming whether that is intended.",
  },
] as const;

type ReviewType = "comment" | "changes";

/** Sample of the publication preview: toggles change the exact text GitHub would receive. */
export function LandingPublicationDemo() {
  const id = useId();
  const [reviewType, setReviewType] = useState<ReviewType>("comment");
  const [included, setIncluded] = useState<Record<string, boolean>>({
    "negative-total": true,
    "case-sensitive": false,
  });
  const [fallback, setFallback] = useState(false);
  const chosen = findings.filter((finding) => included[finding.id]);
  const summary =
    chosen.length === 0
      ? "No findings are included. This posts a summary only."
      : chosen.length === 1
        ? "One concern worth a look before merge:"
        : `${chosen.length} concerns worth a look before merge:`;

  return (
    <div className={styles.demo}>
      <div
        className={styles.demoOutput}
        aria-live="polite"
        aria-label="Sample publication output"
      >
        <div className={styles.demoHead}>
          <span>To hjwebb01/meteroite-review-fixture #1</span>
          <span>{reviewType === "comment" ? "Comment" : "Request changes"}</span>
        </div>
        <div className={styles.demoBody}>
          <p className={styles.demoLabel}>Review body</p>
          <p>Meteroite review of 8c21e4a</p>
          <p>{summary}</p>
          {chosen.map((finding) => (
            <p key={finding.id}>
              – {finding.body}
              {fallback && `: ${finding.inline}`}
            </p>
          ))}
        </div>
        {!fallback &&
          chosen.map((finding) => (
            <div key={finding.id} className={styles.demoInline}>
              <p className={styles.demoLabel}>
                Inline comment · <code>{finding.target}</code>
              </p>
              <p>{finding.inline}</p>
            </div>
          ))}
        {fallback && (
          <p className={styles.demoNote}>
            Summary-only fallback: used only if GitHub rejects inline placement.
            The comments move into the body.
          </p>
        )}
      </div>

      <div className={styles.demoControls}>
        <div
          role="radiogroup"
          aria-labelledby={`${id}-type`}
          className={styles.demoRow}
        >
          <span id={`${id}-type`}>Review type</span>
          <div className={styles.segmented}>
            {(["comment", "changes"] as const).map((type) => (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={reviewType === type}
                onClick={() => setReviewType(type)}
              >
                {type === "comment" ? "Comment" : "Request changes"}
              </button>
            ))}
          </div>
        </div>
        {findings.map((finding) => (
          <label key={finding.id} className={styles.demoRow}>
            <span>{finding.label}</span>
            <input
              type="checkbox"
              role="switch"
              className={styles.switch}
              checked={included[finding.id]}
              onChange={(event) =>
                setIncluded((current) => ({
                  ...current,
                  [finding.id]: event.target.checked,
                }))
              }
            />
          </label>
        ))}
        <label className={styles.demoRow}>
          <span>Show fallback version</span>
          <input
            type="checkbox"
            role="switch"
            className={styles.switch}
            checked={fallback}
            onChange={(event) => setFallback(event.target.checked)}
          />
        </label>
        <dl className={styles.demoFacts}>
          <div>
            <dt>Inline comments</dt>
            <dd>{fallback ? 0 : chosen.length}</dd>
          </div>
          <div>
            <dt>Saved revision</dt>
            <dd>
              <code>8c21e4a</code>
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
