# Review progress design

This design lets a user see where a running review is and that it is still moving. It covers the review screen, the Saved reviews list, and the data the background worker writes. The visual is not part of this design; no prototype was drawn.

## Terms

- **Stage**: one named phase of a review run as the user sees it: loading the pull request, investigating, finishing, or queued. Avoid: step, phase, job. (Inngest "steps" are an internal detail and must not reach the UI.)
- **Latest action**: a one-line description of the most recent tool call the investigation made, such as reading a file or searching for a symbol. Avoid: log, trace.
- **Activity**: the ordered list of tool calls a run has made, each tagged with the stage it ran in. The review screen shows it as a transcript: stage rows, with the tool calls beneath each one. The latest action is the last entry.

## Why

A review takes about 30 to 100 seconds, and most of that is the investigation. The review screen today shows one sentence in the Analysis activity panel, and the Saved reviews list shows nothing. A user who returns to a long run cannot tell whether it is working, queued, or stuck. The aim is to show where the run is and that it is moving. The review screen shows each tool call as it happens, in the form of a chat transcript, so the investigation reads as work in progress rather than one line that keeps changing.

## Locked decisions

- **Stored state (Q10, revised)**: the review row holds the current stage, the latest action, the time of the last action, and `activity`, the run's tool calls in order. `activity` is capped at 200 entries, and the oldest is dropped past the cap. Each run inserts its own review row, so the list starts empty for every run and is never shared across runs. It reuses the existing progress write (`reviewJobs.progress`, which stores `progress`, `updatedAt`, and now appends the `action` to `activity`). A separate per-run history table is still not kept: past runs are not shown, and the Saved reviews list reads only the current stage. Revisit when a screen needs past runs or stage times.
- **Transcript format (revised, supersedes Q2)**: stage rows (Loading pull request, Investigating, Finishing, or Queued) with each tool call listed under the stage that made it. Only the newest entry can be active while the run is live, and a failed or cancelled run marks its newest call as stopped. Each call shows an icon for its tool and the latest call pulses. The list scrolls to the newest entry while the run is live and is capped in height.

## Routine choices

- **Where progress appears (Q1, B)**: a stage line on the review screen and a compact current-stage line on each Saved reviews row. Rejected: the review screen alone (the user returns through Saved reviews, where two concurrent runs need checking), and a header indicator on every page (chrome for a state most visits do not need).
- **Detail inside a stage (Q2, revised)**: every tool call, in a transcript under its stage (see Transcript format). Rejected: stage names only (a long investigation reads as frozen), the latest action alone (the one line keeps changing and loses the calls before it), and a percentage bar (the pipeline has no reliable denominator, since turns are capped at eight and large changes run in parts).
- **Elapsed time (Q3, A)**: total elapsed time for the run, next to the current stage. Rejected: per-stage times (noise for a user who only needs to know the run is moving) and no time.
- **Multi-part reviews (Q4, A)**: one investigate stage whose text is a count, such as "Investigating in 3 parts, 1 done". Rejected: one row per part (pays off only on the rare large change) and the unchanged single message.
- **Stages (Q5, B)**: three, Load, Investigate, and Finish. Rejected: five as the pipeline runs them (checking evidence and assembling take well under a second, so they would look like progress that never happens) and four.
- **Latest action text (Q6, A)**: tool and path only, such as "Reading src/cart.js". Rejected: tool and full query (noisy, and search terms echo repository text) and tool name only (hides what the review is looking at).
- **Failed or cancelled runs (Q7, A)**: the stage line keeps the stage where the run stopped, marked as failed or cancelled. Rejected: clearing it (loses the most useful fact after a failure) and marking unfinished stages as skipped (implies planned work was dropped).
- **Queued runs (Q8, A)**: a "Queued" stage before Load. Rejected: showing nothing until the run starts, which leaves the Saved reviews row blank in the case where the user most often asks whether anything is happening.
- **Stall warning (Q9, C)**: the existing stall warning stays and is the authority for a stuck run. "Last action N s ago" appears under the stage line, so a slow model turn can be told apart from a stuck run before the threshold. Rejected: keeping the warning alone and replacing it with the time.
- **Write frequency (Q11, A)**: one progress write per tool call and per stage change, with no throttle. Each tool-call write also appends to `activity`. Rejected: throttling to once every few seconds, which would delay the latest action by the throttle window.

## Verified facts

- `convex/reviewJobs.ts`: the `progress` internal mutation patches `progress`, `title`, `stage`, `parts`, `status: "running"`, `latestAction`, `activity`, and `updatedAt`. It returns false, and the worker stops, when the review is no longer queued or running. Its `action` argument (`tool`, `text`) is appended to `activity` after the stage is applied.
- `convex/lib/review_stage.ts`: the `reviewStage` union, the `reviewActivity` validator, and `MAX_REVIEW_ACTIVITY` (200).
- `src/features/reviews/lib/review-activity.ts`: builds the transcript rows from the run. `review-stage.ts` gives the stage names both the stage line and the transcript use.
- `src/features/reviews/inngest/review-pull-request.ts`: stage messages today are "Loading pull request and repository", "Investigating a large change in N parts", "Investigating changes and related code", "Combining findings from every part", and "Checking evidence and preparing findings". Concurrency is limited to two runs per owner.
- `src/features/reviews/components/reviews-workspace.tsx` (the Analysis activity panel): renders the stage line, the transcript (`ReviewActivityFeed`), elapsed time, "Last action N s ago", and the stall warning. The stall check reads from `updatedAt`.
- Both model paths run their tool calls through one wrapper in `src/features/reviews/inngest/review-investigation.ts`, which calls `reportAction` before each call. Both paths therefore write the transcript.

## Risks

- **Write volume**: about 5 to 15 progress writes per review. Each is a short mutation, but the count grows with investigation turns. Revisit if it shows up as cost or load (see Deferred).
- **Untrusted text in the activity**: a path or search term from a pull request is repository text. Each entry is built by `describeReviewAction`, which sanitizes and truncates it to one line, and the transcript renders it as plain text, never as markup or instructions.
- **Two model paths**: the OpenRouter and ChatGPT paths both go through the shared tool wrapper. A path that skipped it would leave the transcript empty for that provider.
- **Row size**: `activity` is capped at 200 entries per run so the review row stays well under Convex's document size limit.
- **Stall threshold**: the "Last action N s ago" line reads from the same `updatedAt` the stall check uses, so the two must stay consistent.

## Deferred

- **Past runs and per-run stage history (Q10)**: the transcript covers only the current run. Reopen when a screen needs past runs or past stage times.
- **Throttled writes (Q11, B)**: reopen if the write count shows up as cost or load.
- **Per-part rows for multi-part reviews (Q4, B)**: reopen if users with large changes ask which part is slow.
- **Elapsed time per stage (Q3, B)**: reopen if users need to find which stage is slow, not whether the run is moving.

## Open threads

None. Every branch of the interview ended with a decision.
