# Visual language and reading-surface rules

The interface separates surfaces by tone, keeps one sage action per screen, and never implies a reviewer read something it did not. These rules were code comments; DESIGN.md holds the full system.

## Decisions

- `src/app/globals.css` (`--shadow-2xs: 0 0 #0000;`): Surfaces are separated by tone, never by a resting shadow.
- `src/app/globals.css` (`--text-xs: 0.8125rem;`): Hanken sets small; one step up keeps running text at 15px and above.
- `src/app/globals.css` (`:root,`): One production appearance; shared component tokens keep their public names.
- `src/app/globals.css` (`--radius: 0rem;`): Controls and surfaces are square; only avatars and status dots stay round.
- `src/app/globals.css` (`:root {`): Charcoal grounds, sage marks the one action; the concrete field holds notes the reader must weigh.
- `src/app/globals.css` (`@keyframes cool {`): Finding dismissal keeps its existing local feedback, without ambient motion.
- `src/app/globals.css` (`@layer base {`): Press feedback does not shift the source or contract reading surfaces.
- `src/app/globals.css` (`.review-field {`): Secondary ink and links darken on the field so they keep their contrast.
- `src/app/layout.tsx` (`const code = Spline_Sans_Mono({`): Code, file paths and revision ids only.
- `src/features/auth/components/landing-rail.tsx` (`export function LandingRail({ items }: { items: RailItem[] }) {`): Page navigation. The marker shows where you are; it never claims anything is read.
- `src/features/auth/components/landing-rail.tsx` (`const observer = new IntersectionObserver(`): The section crossing the upper third of the viewport is the current one.
- `src/features/auth/components/landing.module.css` (`.primary {`): The one sage action on a screen.
- `src/features/auth/components/landing.module.css` (`.secondary {`): Secondary: outlined in border-strong, so the sage action stays unique.
- `src/features/auth/components/landing.module.css` (`@keyframes rise {`): Motion: the hero assembles once on load. Reduced motion gets the finished page.
- `src/features/reviews/components/review-diff-parts.tsx` (`export function InlineCode({ text }: { text: string }) {`): Findings may include code spans without requiring a Markdown renderer.
- `src/features/reviews/components/review-reader.module.css` (`@container (min-width: 64rem) {`): A 17rem context spine and at least 45rem of source must both fit.
- `src/features/reviews/components/review-reader.tsx` (`sourceOnly?: boolean;`): Saved evidence is available during activity without implying a generated result.
- `src/features/reviews/lib/discussion-session.ts` (`export function createDiscussionSessions() {`): Owned by the saved reader, so virtualized annotations can safely unmount.
- `src/features/reviews/lib/review-diff.ts` (`export function diffSideOf(side?: "LEFT" | "RIGHT") {`): The diff side a code reference is annotated on. Only removed lines are "deletions"; a missing side reads as "additions".
- `src/features/reviews/lib/review-diff.ts` (`export function toGitPatch(file: SavedFile & { patch: string }) {`): GitHub's per-file patch is hunks only; Pierre needs git file headers.
- `src/features/reviews/lib/review-diff.ts` (`if (from !== file.filename)`): Pierre reads renames from the similarity line. GitHub gives no score; a renamed file with a patch changed, so any value below 100% is accurate.
- `src/features/reviews/lib/review-diff.ts` (`export function buildDiffItems(`): One CodeView item per diff, with findings anchored on their changed line. All saved files remain present; annotations and navigation only affect expansion.
- `src/features/reviews/lib/review-diff.ts` (`version: hashString(`): CodeView re-renders an existing item only when its version changes.
- `src/features/reviews/components/review-reader.tsx`: The selected group's read checkbox is in the source header.
