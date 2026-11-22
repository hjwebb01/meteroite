"use client";

import { SignInButton } from "@clerk/nextjs";
import Image from "next/image";
import Link from "next/link";
import { Wordmark } from "@/components/wordmark";
import { LandingMovedCard } from "./landing-moved-card";
import { LandingPublicationDemo } from "./landing-publication-demo";
import { LandingRail, type RailItem } from "./landing-rail";
import styles from "./landing.module.css";
import { SampleReview } from "./sample-review";

const railItems: RailItem[] = [
  { id: "read", label: "Read by purpose" },
  { id: "publish", label: "Preview the post" },
  { id: "start", label: "Start a review" },
];

const ReviewButton = ({
  className,
  label,
}: {
  className: string;
  label: string;
}) => (
  <SignInButton mode="modal">
    <button type="button" className={className}>
      {label}
    </button>
  </SignInButton>
);

export const UnauthenticatedView = () => (
  <div className={styles.page}>
    <a href="#publish" className={styles.skip}>
      Skip to the publication preview
    </a>
    <header className={styles.nav}>
      <Link href="/" aria-label="Meteroite home" className={styles.navHome}>
        <Wordmark />
      </Link>
      <ReviewButton className={styles.secondary} label="Review a PR" />
    </header>

    <div className={styles.shell}>
      <LandingRail items={railItems} />

      <main className={styles.main}>
        <section id="read" aria-labelledby="read-title" className={styles.hero}>
          <h1 id="read-title" className={styles.display}>
            Know where to start reading this pull request
          </h1>
          <p className={styles.lede}>
            Meteroite splits a pull request by purpose. Each section says what a
            change is for and links to the exact lines behind it.
          </p>
          <div className={styles.stage}>
            <SampleReview />
          </div>
        </section>

        <section
          id="publish"
          aria-labelledby="publish-title"
          className={styles.section}
        >
          <figure className={styles.plate}>
            <Image
              src="/meteorites/laguna-manantiales.jpg"
              alt="Close-up of the Widmanstätten pattern on the etched face of the Laguna Manantiales iron meteorite"
              width={1600}
              height={1200}
              sizes="(max-width: 760px) 100vw, 44rem"
            />
            <figcaption>
              <a href="https://commons.wikimedia.org/w/index.php?curid=25142249">
                Laguna Manantiales iron meteorite
              </a>{" "}
              by Daderot, CC0. All via Wikimedia Commons.
            </figcaption>
          </figure>
          <h2 id="publish-title" className={styles.heading}>
            Nothing posts unseen
          </h2>
          <p className={styles.intro}>
            Meteroite shows the exact comment GitHub will receive. Change what
            is included and watch the text change. In the app, Publish sends
            this and nothing else.
          </p>
          <LandingPublicationDemo />
          <p className={styles.small}>
            Confirming in the app binds this exact text to the target and
            revision.
          </p>
        </section>

        <section
          id="start"
          aria-labelledby="start-title"
          className={`${styles.section} ${styles.start}`}
        >
          <h2 id="start-title" className={styles.heading}>
            The branch moves. Your reading stays.
          </h2>
          <p className={styles.intro}>
            Meteroite pins the head commit you review as your saved revision.
            Your read marks stay with it. When the PR moves on, keep reading
            what you saved or ask for a fresh assessment. Nothing reaches GitHub
            until you publish it.
          </p>
          <LandingMovedCard />
          <ReviewButton className={styles.primary} label="Start a review" />
        </section>
      </main>
    </div>

    <footer className={styles.footer}>
      <p>Private pull request review</p>
    </footer>
  </div>
);
