"use client";

import { SignInButton } from "@clerk/nextjs";
import Image from "next/image";
import Link from "next/link";
import { useId, type ReactNode } from "react";
import { Wordmark } from "@/components/wordmark";
import { LandingPublicationDemo } from "./landing-publication-demo";
import styles from "./landing.module.css";
import { SampleReview } from "./sample-review";

interface Feature {
  title: string;
  detail: string;
  fragment: ReactNode;
}

const features: Feature[] = [
  {
    title: "Read by purpose",
    detail:
      "Each section says what a change is for and links to the exact lines behind it. Nothing is claimed beyond those links.",
    fragment: (
      <ul className={styles.fragList}>
        <li>
          <span>Calculate the discounted total</span>
          <span>total.ts · new 18–25 · 1 finding</span>
        </li>
        <li>
          <span>Accept a code at checkout</span>
          <span>discount-code.ts · new 7–11</span>
        </li>
        <li>
          <span>Store the code on the order</span>
          <span>order.ts · new 40–52</span>
        </li>
      </ul>
    ),
  },
  {
    title: "Findings open at their line",
    detail:
      "A concern expands under the code it is about, with its evidence, a suggested fix and the discussion. The rest stay compact.",
    fragment: (
      <div className={styles.fragCode} aria-hidden>
        <div>
          <span>22</span>
          <span />
          <code>{"  }"}</code>
        </div>
        <div data-kind="added">
          <span>23</span>
          <span>+</span>
          <span />
        </div>
        <div data-kind="added">
          <span>24</span>
          <span>+</span>
          <code>{"  return subtotal - amount;"}</code>
        </div>
        <p className={styles.fragFinding}>
          <span>High</span> · The total can go below zero
        </p>
        <div>
          <span>25</span>
          <span />
          <code>{"}"}</code>
        </div>
      </div>
    ),
  },
  {
    title: "Mark what you have read",
    detail:
      "Reading marks are yours, saved per revision, and never set by scrolling or by the model finishing.",
    fragment: (
      <div className={styles.fragStack}>
        <p className={styles.fragMuted}>1 of 3 sections read at 8c21e4a</p>
        <p className={styles.fragRow}>
          <span>Calculate the discounted total</span>
          <span className={styles.fragOn}>Read</span>
        </p>
        <p className={styles.fragRow}>
          <span>Accept a code at checkout</span>
          <span className={styles.fragOff}>Mark read</span>
        </p>
        <p className={styles.fragRow}>
          <span>Store the code on the order</span>
          <span className={styles.fragOff}>Mark read</span>
        </p>
      </div>
    ),
  },
  {
    title: "Every hunk, on demand",
    detail:
      "The full inventory is one click from the brief, whatever the filters. Source the brief did not group is counted, not hidden.",
    fragment: (
      <div className={styles.fragStack}>
        <p className={styles.fragSearch}>Search files and hunks</p>
        <p className={styles.fragMuted}>
          All changes · 4 files · 6 hunks · 1 ungrouped
        </p>
        <p className={styles.fragRow}>
          <code>src/checkout/total.ts</code>
          <span>+7 −1</span>
        </p>
        <p className={styles.fragRow}>
          <code>src/checkout/discount-code.ts</code>
          <span>+3 −1</span>
        </p>
        <p className={styles.fragRow}>
          <code>package-lock.json</code>
          <span className={styles.fragWarn}>ungrouped</span>
        </p>
      </div>
    ),
  },
  {
    title: "New commits wait for you",
    detail:
      "When the PR moves past your saved revision, you choose: keep reading what you saved, or ask for a fresh assessment.",
    fragment: (
      <div className={`${styles.fragStack} review-field ${styles.fragField}`}>
        <p className={styles.fragStrong}>This PR has moved on</p>
        <p>Saved at 8c21e4a. The branch is now at f93b10d, 2 commits later.</p>
        <p className={styles.fragActions}>
          <span>Inspect 8c21e4a</span>
          <span>Reassess at f93b10d</span>
        </p>
      </div>
    ),
  },
  {
    title: "Nothing posts unseen",
    detail:
      "Your review is private. Publishing shows the exact body and inline comments GitHub will receive, then waits for you.",
    fragment: (
      <div className={styles.fragStack}>
        <p className={styles.fragStrong}>
          Publishing to hjwebb01/meteroite-review-fixture #1
        </p>
        <p className={styles.fragMuted}>Review body · 3 lines · Comment</p>
        <p>
          <code>total.ts:24</code> · inline comment
        </p>
        <p className={styles.fragMuted}>
          Stays private: 1 discussion, 1 read mark, 0 proposals
        </p>
        <span className={styles.fragButton}>Publish exactly this</span>
      </div>
    ),
  },
];

export const UnauthenticatedView = () => {
  const id = useId();

  return (
    <div className={styles.page}>
      <a href={`#${id}-main`} className={styles.skip}>
        Skip to the sample review
      </a>
      <header className={styles.nav}>
        <Link href="/" aria-label="Meteroite home" className={styles.navHome}>
          <Wordmark />
        </Link>
        <nav aria-label="Primary" className={styles.navLinks}>
          <div className={styles.navAnchors}>
            <a href={`#${id}-main`}>Sample review</a>
            <a href={`#${id}-how`}>How it works</a>
            <a href={`#${id}-publishing`}>Publishing</a>
          </div>
          <SignInButton mode="modal">
            <button type="button" className={styles.navSignIn}>
              Sign in
            </button>
          </SignInButton>
        </nav>
      </header>

      <main>
        <section aria-labelledby={`${id}-thesis`} className={styles.hero}>
          <div className={styles.heroHead}>
            <h1 id={`${id}-thesis`} className={styles.display}>
              Read the pull request by purpose
            </h1>
            <p className={styles.lede}>
              Meteroite cuts someone else’s PR into what each change is for,
              then opens the exact source beside it.
            </p>
            <div className={styles.actions}>
              <SignInButton mode="modal">
                <button type="button" className={styles.primary}>
                  Review a real PR
                </button>
              </SignInButton>
              <a href={`#${id}-main`}>Try the sample below</a>
            </div>
          </div>
          <div id={`${id}-main`} className={styles.stage}>
            <div className={styles.stageFrame}>
              <SampleReview />
            </div>
          </div>
        </section>

        <section
          aria-labelledby={`${id}-cut`}
          className={`review-field ${styles.cut}`}
        >
          <div className={styles.cutInner}>
            <div className={styles.cutHero}>
              <Image
                src="/meteorites/willamette.jpg"
                alt="An etched slab of the Willamette iron meteorite, its crystal bands showing across the cut face"
                width={1200}
                height={1600}
                sizes="(max-width: 760px) 100vw, 50vw"
              />
            </div>
            <div className={styles.cutText}>
              <h2 id={`${id}-cut`} className={styles.heading}>
                Cut it open first
              </h2>
              <p className={styles.statement}>
                An iron meteorite looks like any dark stone until its face is
                cut and etched. Then the structure shows.
              </p>
              <p>
                Meteroite does the same to a pull request. Before you read a
                line, the diff is split along what each change is for, and each
                part links to the source that supports it. The account is
                generated and says so once; the source is exact.
              </p>
              <div className={styles.cutFigures}>
                <figure>
                  <Image
                    src="/meteorites/dronino.jpg"
                    alt="A polished slice of the Dronino iron meteorite standing on a reflective table"
                    width={1600}
                    height={1133}
                    sizes="(max-width: 760px) 100vw, 25vw"
                  />
                  <figcaption>Dronino iron, sliced and polished.</figcaption>
                </figure>
                <figure>
                  <Image
                    src="/meteorites/weekeroo.jpg"
                    alt="A cut slice of the Weekeroo Station iron meteorite with silicate inclusions"
                    width={1600}
                    height={996}
                    sizes="(max-width: 760px) 100vw, 25vw"
                  />
                  <figcaption>Weekeroo Station iron, cut and etched.</figcaption>
                </figure>
              </div>
            </div>
          </div>
        </section>

        <section aria-labelledby={`${id}-features`} className={styles.section}>
          <h2 id={`${id}-features`} className={styles.heading}>
            Built for the reader
          </h2>
          <div className={styles.features}>
            {features.map((feature, index) => (
              <div
                key={feature.title}
                className={styles.feature}
                data-flip={index % 2 === 1}
              >
                <div className={styles.featureText}>
                  <h3>{feature.title}</h3>
                  <p>{feature.detail}</p>
                </div>
                <div className={styles.featureFragment} data-ui>
                  {feature.fragment}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby={`${id}-how`} className={styles.section}>
          <div className={styles.run}>
            <h2 id={`${id}-how`} className={styles.heading}>
              How a review runs
            </h2>
            <p>
              <strong>To begin,</strong> paste the link to the pull request you
              were asked to review, and say what to watch for if you like.
              Meteroite pins the head commit as your saved revision, so
              everything after refers to the code you actually saw.
            </p>
            <div className={styles.runFragment} data-ui aria-hidden>
              <span className={styles.runInput}>
                github.com/hjwebb01/meteroite-review-fixture/pull/1
              </span>
              <span className={styles.fragButton}>Start review</span>
            </div>
            <p>
              <strong>While it reads,</strong> the activity view reports what is
              really happening: queued, reading, stopped reporting, failed or
              done. No percentages it cannot know. You can leave and come back;
              the work is saved.
            </p>
            <div className={styles.runActivity} data-ui aria-hidden>
              <p>
                <span>Reading the diff</span>
                <span className={styles.runActive}>Active · 1 min 12 s</span>
              </p>
              <p>
                <span>Fetched 4 files at 8c21e4a</span>
                <span>Done</span>
              </p>
              <p>
                <span>Grouping changes by purpose</span>
                <span>Waiting</span>
              </p>
            </div>
            <p>
              <strong>When the brief is ready,</strong> the PR arrives cut open:
              a short account of the change and its sections by purpose. Choose
              one and the brief folds into a narrow spine while the source takes
              the width.
            </p>
            <figure className={styles.runFigure}>
              <Image
                src="/meteorites/laguna-manantiales.jpg"
                alt="Close-up of the Widmanstätten pattern on the etched face of the Laguna Manantiales iron meteorite"
                width={1600}
                height={1200}
                sizes="(max-width: 760px) 100vw, 60vw"
              />
              <figcaption>
                Laguna Manantiales iron, found 1945. The crossing bands appear
                only once the face is etched.
              </figcaption>
            </figure>
          </div>
        </section>

        <section aria-labelledby={`${id}-publishing`} className={styles.section}>
          <div className={styles.run}>
            <h2 id={`${id}-publishing`} className={styles.heading}>
              See it before it posts
            </h2>
            <p>
              Change what is included and watch the exact output change. In the
              app, Publish sends this and nothing else.
            </p>
            <LandingPublicationDemo />
            <p className={styles.small}>
              Sample output. Confirming in the app binds this exact text to the
              target and revision.
            </p>
          </div>
        </section>

        <section aria-label="Start a review" className={styles.section}>
          <div className={styles.run}>
            <p className={styles.cta}>
              Paste a pull request you were asked to review and read it by
              purpose.
            </p>
            <div className={styles.actions}>
              <SignInButton mode="modal">
                <button type="button" className={styles.primary}>
                  Sign in to start
                </button>
              </SignInButton>
              <a href={`#${id}-main`}>Back to the sample</a>
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <p className={styles.credits}>
          Pictures:{" "}
          <a href="https://commons.wikimedia.org/w/index.php?curid=109628650">
            Willamette etched slab
          </a>{" "}
          by Daderot, CC0;{" "}
          <a href="https://commons.wikimedia.org/w/index.php?curid=114467788">
            Full Metal Beauty of the Dronino Meteorite
          </a>{" "}
          by Steve Jurvetson,{" "}
          <a href="https://creativecommons.org/licenses/by/2.0/">CC BY 2.0</a>;{" "}
          <a href="https://commons.wikimedia.org/w/index.php?curid=47485934">
            Weekeroo Station iron
          </a>{" "}
          by Daderot, CC0;{" "}
          <a href="https://commons.wikimedia.org/w/index.php?curid=25142249">
            Laguna Manantiales iron meteorite
          </a>{" "}
          by Daderot, CC0. All via Wikimedia Commons.
        </p>
        <p className={styles.footLine}>
          <span>Private pull request review</span>
          <span>Nothing reaches GitHub until you publish it.</span>
        </p>
      </footer>
    </div>
  );
};
