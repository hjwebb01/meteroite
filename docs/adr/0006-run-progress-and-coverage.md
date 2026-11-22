# Run progress is stage, activity and coverage, not a spinner

A review run shows its coarse stage, the tool calls it made, and how much of the change it opened, so the owner can judge a result by what the reviewer actually read. Older runs lack these fields and must still render. These rules were code comments.

## Decisions

- `convex/lib/review_stage.ts` (`export const MAX_REVIEW_ACTIVITY = 200;`): Newest tool calls kept per run; older ones are dropped to bound the row size.
- `convex/lib/review_stage.ts` (`at: v.optional(v.number()),`): When the call started; absent on runs saved before timestamps.
- `convex/reviewJobs.ts` (`action: v.optional(reviewActionInput),`): Omitted writes clear the latest action, so a stage change never shows a stale call.
- `convex/schema.ts` (`stage: v.optional(reviewStage),`): Current phase while running; kept after a failure or cancel to show where it stopped.
- `src/features/reviews/components/review-replay.tsx` (`const FILES = [`): Shaped like a run on the fixture PR (github.com/hjwebb01/meteroite-review-fixture pull/1). The offsets are modelled on the 31-run timing sample, not recorded from a live run: the test user has no GitHub connection to run one.
- `convex/lib/review_lifecycle.ts` (`export const STALL_LIMIT_MS = 15 * 60_000;`): Each worker step reports progress, and a step is bounded at a few minutes, so a longer silence means the worker died without recording why. The janitor ends such a Stalled Review as failed.
- `src/features/reviews/inngest/review-pull-request.ts` (`const reportAction = async (`): Per tool call: the stage line keeps its text and the call joins the activity list.
- `src/features/reviews/inngest/review-pull-request.ts` (`const partRun = { ...run, prepareFindings: checkActive };`): Parts finish while others still investigate; only synthesis announces that findings are being prepared.
- `src/features/reviews/lib/review-coverage.test.ts` (`const files = [`): Hand-counted from github.com/hjwebb01/meteroite-review-fixture pull/1: src/cart.js adds lines 1-2 and 6-10 (7), src/discount.js adds 1-13 (13), test/cart.test.js adds 17-20 (4): 24 added lines in all.
- `src/features/reviews/lib/review-coverage.ts` (`export function computeCoverage(`): Added lines the reviewer opened with readFile over all added lines in the PR. Removed lines cannot be opened at the pinned head, and a file without a patch has no known line count, so both stay out of the ratio; a patchless file never opened is still listed in `unread`.
- `src/features/reviews/lib/review-coverage.ts` (`export function evidenceTrail(`): The tool calls that read a cited line, as 1-based positions in `activity`, and whether the line was already in the diff handed to the reviewer.
- `src/features/reviews/lib/review-estimate.ts` (`const MEDIAN_MS = 61_000;`): Calibrated from 31 completed runs: median ~61 s, 80th percentile ~160 s.
- `src/features/reviews/lib/review-stage.ts` (`export function reviewStageLabel(run: StageRun): string | null {`): The stage line for a run that is not complete, or null when there is none to show. A failed or cancelled run keeps the stage where it stopped.
