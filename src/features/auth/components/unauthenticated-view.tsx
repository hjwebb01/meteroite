import { SignInButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";

export const UnauthenticatedView = () => {
  return (
    <main className="flex min-h-svh items-center justify-center bg-review-bg px-5 py-10 text-review-text">
      <section className="w-full max-w-md rounded-md border border-review-border bg-review-chrome p-6 sm:p-8">
        <Wordmark />
        <p className="mt-8 font-mono text-xs uppercase tracking-wider text-review-muted">
          Private code review
        </p>
        <h1 className="mt-3 font-serif text-[30px] leading-[1.1] tracking-[-0.02em]">
          Follow the evidence.
        </h1>
        <p className="mt-3 text-sm leading-6 text-review-body">
          Sign in to review pull requests, investigate findings, and revisit
          your saved reviews.
        </p>
        <SignInButton mode="modal">
          <Button className="mt-6 w-full">Sign in to your workspace</Button>
        </SignInButton>
        <p className="mt-5 border-t border-review-border pt-4 text-xs leading-5 text-review-muted">
          Reviews and discussions stay private. You choose when to publish a
          review or apply a fix.
        </p>
      </section>
    </main>
  );
};
