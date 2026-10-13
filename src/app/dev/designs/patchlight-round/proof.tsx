"use client";

import { useId, useState } from "react";
import { findings, sampleUrl, useSampleReview } from "../sample";
import s from "./proof.module.css";
const currencyFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function Proof() {
  const r = useSampleReview();
  const id = useId();
  const [basket, setBasket] = useState(20);
  const [discount, setDiscount] = useState(25);
  const [expired, setExpired] = useState(true);
  const [code, setCode] = useState("welcome10");
  const selected = r.reviewing ? r.active : 1;
  const actual =
    selected === 2 ? code.trim() === "WELCOME10" : basket - discount;
  const expected =
    selected === 2
      ? code.trim().toUpperCase() === "WELCOME10"
      : selected === 0
        ? expired
          ? basket
          : basket - discount
        : Math.max(0, basket - discount);
  const reproduces = actual !== expected;
  const money = (value: number) => currencyFormat.format(value);
  const showResult = (value: number | boolean) =>
    typeof value === "boolean"
      ? value
        ? "Code found"
        : "Not found"
      : money(value);
  const f = findings[selected];
  return (
    <main className={s.canvas}>
      <header className={s.header}>
        <span className={s.brand}>
          meteroite<span> / proof</span>
        </span>
        <span>PRIVATE REVIEW, REPRODUCIBLE EVIDENCE</span>
        <span className={s.local}>Local simulation</span>
      </header>
      {!r.reviewing ? (
        <>
          <div className={s.landingHeading}>
            <div>
              <p>One line of code. One observable consequence.</p>
              <h1>
                A discount.
                <br />
                Or a debt?
              </h1>
            </div>
            <div className={s.verdict}>
              <span>
                A {money(basket)} basket with a {money(discount)} discount
              </span>
              <strong>{showResult(actual)}</strong>
              <small>Current sample payment amount</small>
            </div>
          </div>
          <p className={s.lead}>
            Don’t take a finding on faith. Change the inputs. See where the code
            takes them.
          </p>
        </>
      ) : (
        <div className={s.reviewHeading}>
          <div>
            <p>{r.target}</p>
            <h1>Put the finding to the test.</h1>
          </div>
          <button onClick={() => r.setReviewing(false)}>
            ← Back to intake
          </button>
        </div>
      )}
      {r.reviewing && (
        <nav className={s.scenarios} aria-label="Finding scenarios">
          {findings.map((finding, index) => (
            <button
              key={finding.id}
              aria-pressed={selected === index}
              onClick={() => r.select(index)}
            >
              <span>
                {finding.severity} ·{" "}
                {r.resolved.includes(index) ? "Resolved" : "Open"}
              </span>
              <strong>
                {index === 0
                  ? "An expired code"
                  : index === 1
                    ? "An oversized discount"
                    : "A lowercase code"}
              </strong>
              <small>
                {finding.file.split("/").at(-1)}:{finding.line}
              </small>
            </button>
          ))}
        </nav>
      )}
      <section className={s.bench} aria-label="Interactive sample reproduction">
        <div className={s.inputs}>
          <h2>Change the input</h2>
          <p>
            These controls run a tiny local model of the sample logic, not
            repository code.
          </p>
          {selected === 2 ? (
            <>
              <label htmlFor={`${id}-code`}>Entered discount code</label>
              <input
                id={`${id}-code`}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <p className={s.inputHint}>
                Stored code: <code>WELCOME10</code>
              </p>
              <button
                className={s.preset}
                onClick={() =>
                  setCode(code === "WELCOME10" ? "welcome10" : "WELCOME10")
                }
              >
                Try {code === "WELCOME10" ? "lowercase" : "uppercase"} ↔
              </button>
            </>
          ) : (
            <>
              <label htmlFor={`${id}-basket`}>
                Basket subtotal <strong>{money(basket)}</strong>
              </label>
              <input
                id={`${id}-basket`}
                type="range"
                min="0"
                max="100"
                step="1"
                value={basket}
                onChange={(e) => setBasket(Number(e.target.value))}
              />
              <label htmlFor={`${id}-discount`}>
                Fixed discount <strong>{money(discount)}</strong>
              </label>
              <input
                id={`${id}-discount`}
                type="range"
                min="0"
                max="100"
                step="1"
                value={discount}
                onChange={(e) => setDiscount(Number(e.target.value))}
              />
              {selected === 0 && (
                <label className={s.checkbox}>
                  <input
                    type="checkbox"
                    checked={expired}
                    onChange={(e) => setExpired(e.target.checked)}
                  />{" "}
                  Code has expired
                </label>
              )}
              <button
                className={s.preset}
                onClick={() => {
                  setBasket(20);
                  setDiscount(25);
                  setExpired(true);
                }}
              >
                Reset example ↺
              </button>
            </>
          )}
        </div>
        <div className={s.source}>
          <div className={s.sourceTitle}>
            <span>The logic under review</span>
            <small>
              {f.file}:{f.line}
            </small>
          </div>
          {f.evidence.map((line, index) => (
            <div className={s.codeLine} key={line}>
              <span>{f.line + index}</span>
              <code>{line}</code>
            </div>
          ))}
          <div className={s.trace}>
            <span>Input → operation → result</span>
            <p>
              {selected === 2
                ? `${JSON.stringify(code.trim())} === "WELCOME10" → ${actual}`
                : `${basket} − ${discount} → ${actual}${selected === 0 ? ` · expired: ${expired}` : ""}`}
            </p>
          </div>
          <p className={s.sourceDisclosure}>
            Illustrative excerpt. No code is executed from GitHub.
          </p>
        </div>
        <div className={s.result} aria-live="polite">
          <span className={s.resultLabel}>Observed in this local model</span>
          <strong>{showResult(actual)}</strong>
          <div className={reproduces ? s.failure : s.pass}>
            {reproduces
              ? "Failure reproduced"
              : "This input does not reproduce the failure"}
          </div>
          <table>
            <tbody>
              <tr>
                <th scope="row">Current logic</th>
                <td>{showResult(actual)}</td>
              </tr>
              <tr>
                <th scope="row">With suggested fix</th>
                <td>{showResult(expected)}</td>
              </tr>
            </tbody>
          </table>
          <p>
            {selected === 0
              ? "An expired code should leave the subtotal unchanged."
              : selected === 1
                ? "The amount charged should never be negative."
                : "Matching should ignore the case of the entered code."}
          </p>
        </div>
      </section>
      {!r.reviewing ? (
        <div className={s.intakeRow}>
          <div>
            <h2>Bring the next change.</h2>
            <p>
              The address labels a sample review. No pull request is fetched.
            </p>
          </div>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              r.start();
            }}
          >
            <label htmlFor={`${id}-url`}>GitHub pull request URL</label>
            <div>
              <input
                id={`${id}-url`}
                value={r.url}
                onChange={(e) => r.setUrl(e.target.value)}
                aria-invalid={!!r.error}
                aria-describedby={`${id}-error`}
              />
              <button type="submit">Open sample review ↗</button>
            </div>
            <p id={`${id}-error`} role={r.error ? "alert" : undefined}>
              {r.error}
            </p>
          </form>
          <button className={s.sampleButton} onClick={() => r.start(sampleUrl)}>
            Use sample URL
          </button>
        </div>
      ) : (
        <section className={s.finding}>
          <div>
            <span className={s.issueLabel}>
              {f.severity} severity ·{" "}
              {r.resolved.includes(r.active)
                ? "Resolved locally"
                : "Open finding"}
            </span>
            <h2>{f.title}</h2>
            <p>{f.claim}</p>
            <h3>Suggested change</h3>
            <p>{f.fix}</p>
            <button className={s.resolve} onClick={r.toggle}>
              {r.resolved.includes(r.active)
                ? "Reopen finding"
                : "Mark resolved"}
            </button>
            <small>
              Resolving records your decision; it does not alter the code or the
              simulation.
            </small>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              r.saveNote();
            }}
          >
            <label htmlFor={`${id}-note`}>Keep your reasoning private</label>
            <textarea
              id={`${id}-note`}
              rows={3}
              value={r.draft}
              onChange={(e) => r.setDraft(e.target.value)}
              placeholder="Which input would you test next?"
            />
            <button type="submit" disabled={!r.draft.trim()}>
              Save private note
            </button>
            <div aria-live="polite">
              {r.notes[r.active]?.map((note, index) => (
                <p className={s.savedNote} key={index}>
                  {note}
                </p>
              ))}
            </div>
          </form>
        </section>
      )}
      <footer className={s.footer}>
        <span>Evidence you can question.</span>
        <span>Prototype · Session-only notes · No GitHub publishing</span>
      </footer>
    </main>
  );
}
