"use client";

import { useId } from "react";
import { findings, sampleUrl, useSampleReview } from "./sample";
import s from "./patchlight.module.css";

export function Patchlight() {
  const r = useSampleReview();
  const id = useId();
  return (
    <main className={s.canvas}>
      <aside className={s.spine}>
        <a href="/dev/designs" className={s.brand}>
          m<span>↳</span>
        </a>
        <div className={s.vertical}>METEROITE / PATCHLIGHT</div>
        <span className={s.private}>
          Private
          <br />
          by default
        </span>
      </aside>
      <div className={s.work}>
        <header className={s.toolbar}>
          <span>
            {r.reviewing ? r.target : "A private reading of your next change"}
          </span>
          <span className={s.sample}>LOCAL SAMPLE · NO GITHUB WRITES</span>
        </header>
        {!r.reviewing ? (
          <>
            <div className={s.intro}>
              <div>
                <span className={s.eyebrow}>
                  A review, in its natural habitat.
                </span>
                <h1>
                  Stay in
                  <br />
                  the change.
                </h1>
              </div>
              <p>
                Not another report to reconcile.
                <br />A second set of eyes, right where
                <br />
                the code needs your attention.
              </p>
            </div>
            <div className={s.preview}>
              <div className={s.filebar}>
                <span>discounts.ts</span>
                <span>Sample patch / +3 lines</span>
              </div>
              <div className={s.codeLine}>
                <span>40</span>
                <code>const discount = await findCode(input.code);</code>
              </div>
              <div className={s.codeLine}>
                <span>41</span>
                <code>const total = subtotal - discount.amount;</code>
              </div>
              <button
                className={s.inlinePreview}
                onClick={() => r.start(sampleUrl)}
              >
                <span className={s.marker}>!</span>
                <span>
                  <strong>This code has already changed the total.</strong>
                  <small>
                    But the expiry check hasn’t happened yet. Inspect the sample
                    ↗
                  </small>
                </span>
              </button>
              <div className={s.codeLine}>
                <span>42</span>
                <code>if (discount.expiresAt &lt; now) return total;</code>
              </div>
            </div>
            <form
              className={s.intake}
              onSubmit={(e) => {
                e.preventDefault();
                r.start();
              }}
            >
              <label htmlFor={`${id}-url`}>
                Bring a pull request into focus
              </label>
              <div>
                <span aria-hidden="true">↳</span>
                <input
                  id={`${id}-url`}
                  value={r.url}
                  onChange={(e) => r.setUrl(e.target.value)}
                  aria-invalid={!!r.error}
                  aria-describedby={r.error ? `${id}-error` : `${id}-help`}
                />
                <button type="submit">Open sample review ↗</button>
              </div>
              <p id={`${id}-help`}>
                Prototype only. The URL supplies context; the review below uses
                illustrative checkout findings.
              </p>
              {r.error && (
                <p id={`${id}-error`} role="alert">
                  {r.error}
                </p>
              )}
            </form>
          </>
        ) : (
          <>
            <div className={s.reviewTitle}>
              <div>
                <span className={s.eyebrow}>Illustrative checkout patch</span>
                <h1>Add discount codes</h1>
              </div>
              <button onClick={() => r.setReviewing(false)}>
                ← Another pull request
              </button>
            </div>
            <div className={s.editor}>
              <nav className={s.files} aria-label="Findings by file">
                <span className={s.eyebrow}>Changed source</span>
                {findings.map((f, i) => (
                  <button
                    key={f.id}
                    onClick={() => r.select(i)}
                    aria-current={r.active === i ? "true" : undefined}
                  >
                    <span>
                      {f.file.split("/").at(-1)} <small>L{f.line}</small>
                    </span>
                    <strong>{f.title}</strong>
                    <em>{r.resolved.includes(i) ? "Resolved" : f.severity}</em>
                  </button>
                ))}
                <p>
                  {findings.length - r.resolved.length} open findings
                  <br />
                  Nothing posted to GitHub
                </p>
              </nav>
              <section
                className={s.source}
                aria-label="Selected source and annotation"
              >
                <div className={s.filebar}>
                  <span>{r.finding.file}</span>
                  <span>Source excerpt</span>
                </div>
                <div className={s.contextLine}>
                  <span>⋮</span>
                  <code>{"// checkout discount path"}</code>
                </div>
                {r.finding.evidence.map((line, i) => (
                  <div key={line} className={s.codeLine}>
                    <span>{r.finding.line + i}</span>
                    <code>{line}</code>
                  </div>
                ))}
                <article className={s.annotation}>
                  <div className={s.annotationHeader}>
                    <span className={s.marker}>!</span>
                    <span>
                      {r.finding.severity} severity ·{" "}
                      {r.resolved.includes(r.active)
                        ? "Resolved"
                        : "Needs review"}
                    </span>
                    <span>Meteroite / sample</span>
                  </div>
                  <h2>{r.finding.title}</h2>
                  <p>{r.finding.claim}</p>
                  <div className={s.fix}>
                    <strong>Change to consider</strong>
                    <p>{r.finding.fix}</p>
                  </div>
                  <button className={s.resolve} onClick={r.toggle}>
                    {r.resolved.includes(r.active)
                      ? "Reopen finding"
                      : "Mark resolved"}{" "}
                    <span>✓</span>
                  </button>
                  <form
                    className={s.note}
                    onSubmit={(e) => {
                      e.preventDefault();
                      r.saveNote();
                    }}
                  >
                    <label htmlFor={`${id}-note`}>
                      Your private annotation
                    </label>
                    <textarea
                      id={`${id}-note`}
                      value={r.draft}
                      onChange={(e) => r.setDraft(e.target.value)}
                      placeholder="What should change here?"
                      rows={2}
                    />
                    <button disabled={!r.draft.trim()}>
                      Save private note ↳
                    </button>
                  </form>
                  <div aria-live="polite">
                    {r.notes[r.active]?.map((note, i) => (
                      <p key={i} className={s.savedNote}>
                        <span>You / private</span>
                        {note}
                      </p>
                    ))}
                  </div>
                </article>
                <div className={s.contextLine}>
                  <span>⋮</span>
                  <code>{"// remaining source omitted in this sample"}</code>
                </div>
              </section>
            </div>
          </>
        )}
        <footer className={s.footer}>
          <span>Code first. Conclusions second.</span>
          <span>Sample state lives in this page only.</span>
        </footer>
      </div>
    </main>
  );
}
