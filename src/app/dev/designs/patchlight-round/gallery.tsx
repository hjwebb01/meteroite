"use client";

import { Seam } from "./seam";
import { Current } from "./current";
import { Proof } from "./proof";
import s from "./gallery.module.css";

const concepts = [
  {
    id: "seam",
    name: "Seam",
    verb: "Compare",
    title: "The space between risky and right.",
    description:
      "Two versions of the logic, connected by the finding. Compare the current code with a proposed correction without applying it.",
    traits: "Paired source · Correction seam · Horizontal navigation",
  },
  {
    id: "current",
    name: "Current",
    verb: "Read",
    title: "Let the code carry the review.",
    description:
      "One continuous source stream. Follow the patch, open an annotation, and keep reading without switching panels.",
    traits: "Continuous source · Inline findings · Anchored file navigation",
  },
  {
    id: "proof",
    name: "Proof",
    verb: "Reproduce",
    title: "A claim you can put to the test.",
    description:
      "Change the sample inputs and observe the consequence beside the code. A small interactive reproduction, not another report.",
    traits: "Input controls · Source trace · Observed versus corrected result",
  },
] as const;

export function PatchlightRound({ initialDesign }: { initialDesign?: string }) {
  const concept = concepts.find((item) => item.id === initialDesign);
  if (concept)
    return (
      <>
        <nav className={s.lab} aria-label="Design round navigation">
          <a href="/dev/designs/patchlight-round">← This round</a>
          <span>{concept.name}</span>
          <a href="/dev/designs?design=patchlight">Patchlight reference ↗</a>
        </nav>
        {concept.id === "seam" ? (
          <Seam />
        ) : concept.id === "current" ? (
          <Current />
        ) : (
          <Proof />
        )}
      </>
    );
  return (
    <main className={s.gallery}>
      <header>
        <span>meteroite / design lab</span>
        <a href="/dev/designs?design=patchlight">Original Patchlight ↗</a>
      </header>
      <section className={s.heading}>
        <p>PATCHLIGHT / NEXT EXPLORATION</p>
        <h1>
          Keep the code.
          <br />
          Change the perspective.
        </h1>
        <div>
          Three source-first ideas, each with a different way to examine a
          finding.
          <br />
          Independent layouts. Interactive samples. Nothing published.
        </div>
      </section>
      <div className={s.directions}>
        {concepts.map((item) => (
          <a
            href={`?design=${item.id}`}
            key={item.id}
            className={`${s.direction} ${s[item.id]}`}
          >
            <div className={s.caption}>
              <span>{item.verb}</span>
              <h2>
                {item.name}
                <b>↗</b>
              </h2>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              <small>{item.traits}</small>
            </div>
            <div className={s.preview} aria-hidden="true">
              {item.id === "seam" ? (
                <div className={s.seamPreview}>
                  <div>
                    <small>Current logic</small>
                    <code>
                      total = subtotal − amount;
                      <br />
                      if (expired) return total;
                    </code>
                  </div>
                  <strong>↔ Check expiry first</strong>
                  <div>
                    <small>Proposed correction</small>
                    <code>
                      if (expired) return subtotal;
                      <br />
                      total = subtotal − amount;
                    </code>
                  </div>
                </div>
              ) : item.id === "current" ? (
                <div className={s.currentPreview}>
                  <small>discounts.ts / continuous source</small>
                  <code>
                    40 &nbsp; const discount = findCode(input);
                    <br />
                    41 &nbsp; const total = subtotal − amount;
                  </code>
                  <strong>↳ This check comes too late.</strong>
                  <code>
                    42 &nbsp; if (expired) return total;
                    <br />
                    43 &nbsp; return createPayment(total);
                  </code>
                </div>
              ) : (
                <div className={s.proofPreview}>
                  <div>
                    <small>Input</small>
                    <strong>$20 − $25</strong>
                    <span>Basket · Discount</span>
                  </div>
                  <b>→</b>
                  <div>
                    <small>Observed</small>
                    <strong>−$5.00</strong>
                    <span>Failure reproduced</span>
                  </div>
                </div>
              )}
            </div>
          </a>
        ))}
      </div>
      <footer>
        <a href="/dev/designs">Previous round ←</a>
        <span>Development-only · Local sample data · Production unchanged</span>
      </footer>
    </main>
  );
}
