"use client";

import Link from "next/link";
import { Cartography } from "./cartography";
import { CrossExamination } from "./cross-examination";
import { Patchlight } from "./patchlight";
import s from "./exploration-gallery.module.css";

const concepts = [
  {
    id: "cartography",
    name: "Cartography",
    mode: "Navigate by consequence",
    description:
      "A spatial atlas of the change. Follow a defect from customer input to the amount charged.",
    signature: "Impact map / connected stations / contextual legend",
  },
  {
    id: "cross-examination",
    name: "Cross-examination",
    mode: "Decide one claim at a time",
    description:
      "A quiet, focused second opinion. Examine the evidence before accepting the conclusion.",
    signature: "Single claim / evidence fold / deliberate decisions",
  },
  {
    id: "patchlight",
    name: "Patchlight",
    mode: "Read the change itself",
    description:
      "The patch is the workspace. Inspect private annotations exactly where the logic breaks.",
    signature: "Source canvas / inline annotations / file spine",
  },
] as const;

export function ExplorationGallery({
  initialDesign,
}: {
  initialDesign?: string;
}) {
  const selected = concepts.find((concept) => concept.id === initialDesign);
  if (selected)
    return (
      <>
        <nav className={s.lab} aria-label="Prototype navigation">
          <a href="/dev/designs">← All ideas</a>
          <span>{selected.name}</span>
          <span>Development prototype</span>
        </nav>
        {selected.id === "cartography" ? (
          <Cartography />
        ) : selected.id === "cross-examination" ? (
          <CrossExamination />
        ) : (
          <Patchlight />
        )}
      </>
    );
  return (
    <main className={s.gallery}>
      <header>
        <Link href="/" className={s.brand}>
          meteroite<span> / design lab</span>
        </Link>
      </header>
      <section className={s.heading}>
        <p>New ways to see a change</p>
        <h1>
          Three ideas.
          <br />
          No shared blueprint.
        </h1>
        <div>
          Same review. Different mental models.
          <br />
          Explore the landing and review experience in each direction.
        </div>
      </section>
      <div className={s.concepts}>
        {concepts.map((concept) => (
          <a
            href={`?design=${concept.id}`}
            key={concept.id}
            className={`${s.concept} ${s[concept.id]}`}
          >
            <div className={s.mini} aria-hidden="true">
              {concept.id === "cartography" ? (
                <div className={s.mapMini}>
                  <span>INPUT</span>
                  <i />
                  <span>
                    LOOKUP <b>!</b>
                  </span>
                  <i />
                  <span>PAYMENT</span>
                  <strong>Follow the change.</strong>
                </div>
              ) : concept.id === "cross-examination" ? (
                <div className={s.claimMini}>
                  <small>CLAIM 1 / 3</small>
                  <strong>
                    Should this code
                    <br />
                    still apply?
                  </strong>
                  <span>Examine the evidence ↗</span>
                </div>
              ) : (
                <div className={s.patchMini}>
                  <small>discounts.ts</small>
                  <code>
                    40 &nbsp; const discount = findCode(input);
                    <br />
                    41 &nbsp; const total = subtotal - amount;
                  </code>
                  <strong>↳ The expiry check comes too late.</strong>
                  <code>42 &nbsp; if (expired) return total;</code>
                </div>
              )}
            </div>
            <div className={s.caption}>
              <span>{concept.mode}</span>
              <h2>
                {concept.name}
                <b>↗</b>
              </h2>
              <p>{concept.description}</p>
              <small>{concept.signature}</small>
            </div>
          </a>
        ))}
      </div>
      <footer>
        <span>
          Interactive, local-only samples. No pull request is fetched or
          modified.
        </span>
        <span>No production direction selected.</span>
      </footer>
    </main>
  );
}
