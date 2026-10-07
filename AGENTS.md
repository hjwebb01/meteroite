# Repository instructions

## Documentation

Never add documentation or migration reports merely because a change is large or complex. Report changes and verification in the conversation instead.

Add documentation only when Hunter explicitly requests it or explicitly invokes a skill that requires documentation. Keep those documents within the requested or skill-defined scope. Choosing to use a skill yourself does not authorize extra documentation.

Periodically review permitted documentation while working on the related area. Update it to reflect current behavior and decisions, and remove stale details. Do not create additional documents as part of that review.

## Verification in the app

`npm run check:env` reports which flows can run locally and the secret each blocked flow needs. Sign in through the T3 preview as `meteroite-agent+clerk_test@example.com` with code `424242` (Clerk development test address; no inbox needed).

The UI calls deployed Convex functions, so after changing `convex/` run `npx convex dev --once` to push them to the dev deployment.

Live PR review acceptance runs against https://github.com/hjwebb01/meteroite-review-fixture/pull/1, which carries known defects. Push to its `discount-codes` branch to simulate an external update; reset it with `git push --force origin fixture-pr-base:refs/heads/discount-codes`.

## Parallel work

Commit in-progress work before creating worktrees for parallel agents: worktrees branch from `HEAD` and never see uncommitted changes.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
