"use client";

import { useState } from "react";
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

export function LandingPublicationDemo() {
  const [included, setIncluded] = useState<Record<string, boolean>>({
    "negative-total": true,
    "case-sensitive": false,
  });
  const chosen = findings.filter((finding) => included[finding.id]);
  const summary =
    chosen.length === 0
      ? "No findings are included. This posts a summary only."
      : chosen.length === 1
        ? "One concern worth a look before merge:"
        : `${chosen.length} concerns worth a look before merge:`;

  return (
    <div className={styles.demo}>
      <p className="sr-only" role="status">
        {chosen.length} inline comments included
      </p>
      <div className={styles.demoControls}>
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
      </div>

      <div
        className={styles.demoOutput}
        role="region"
        aria-label="Sample publication output"
      >
        <div className={styles.demoHead}>
          <span>To hjwebb01/meteroite-review-fixture #1</span>
          <span>Sample output</span>
        </div>
        <div className={styles.demoBody}>
          <p className={styles.demoLabel}>Review body · posts as a comment</p>
          <p>Meteroite review of 8c21e4a</p>
          <p>{summary}</p>
          {chosen.map((finding) => (
            <p key={finding.id}>– {finding.body}</p>
          ))}
        </div>
        {chosen.map((finding) => (
          <div key={finding.id} className={styles.demoInline}>
            <p className={styles.demoLabel}>
              Inline comment · <code>{finding.target}</code>
            </p>
            <p>{finding.inline}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
