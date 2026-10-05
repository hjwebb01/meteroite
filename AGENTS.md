# Repository instructions

## Documentation

Never add documentation or migration reports merely because a change is large or complex. Report changes and verification in the conversation instead.

Add documentation only when Hunter explicitly requests it or explicitly invokes a skill that requires documentation. Keep those documents within the requested or skill-defined scope. Choosing to use a skill yourself does not authorize extra documentation.

Periodically review permitted documentation while working on the related area. Update it to reflect current behavior and decisions, and remove stale details. Do not create additional documents as part of that review.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
