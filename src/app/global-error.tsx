"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { Wordmark } from "@/components/wordmark";
import "./globals.css";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main className="flex min-h-svh items-center justify-center bg-review-bg px-5 py-10 text-review-text">
          <section className="w-full max-w-md rounded-md border border-review-border bg-review-chrome p-6">
            <Wordmark />
            <h1 className="mt-6 font-serif text-[24px] leading-tight">
              Workspace couldn’t load
            </h1>
            <p className="mt-3 text-sm leading-6 text-review-body">
              Try loading the workspace again to return to your saved reviews.
            </p>
            <button
              onClick={retry}
              className="mt-5 h-8 rounded-md bg-review-text px-3 text-xs font-medium text-review-bg hover:opacity-90"
            >
              Try again
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
