"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
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
        <main className="review-shell flex min-h-svh items-center justify-center px-5 py-10 text-review-text">
          <section className="w-full max-w-md rounded-md border border-review-border bg-review-chrome p-6">
            <Wordmark />
            <h1 className="mt-6 text-2xl leading-tight font-medium tracking-[-0.03em]">
              Workspace couldn’t load
            </h1>
            <p className="mt-3 text-sm leading-6 text-review-body">
              Try loading the workspace again to return to your saved reviews.
            </p>
            <Button type="button" className="mt-5 min-h-10" onClick={retry}>
              Try again
            </Button>
          </section>
        </main>
      </body>
    </html>
  );
}
