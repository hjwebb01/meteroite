# Review context is budgeted, split, and bounded

A review must never fail merely because a diff is large. Context is metered per call, oversized diffs are split into parts, and hard limits (patch size, file count, batch size) are explicit. These rules were code comments.

## Decisions

- `src/features/reviews/inngest/review-agent.ts` (`export async function runReviewAgent({`): Investigates with read-only tools for up to `maxTurns` turns, then returns the structured review. Each turn is metered from provider-reported usage; when another turn could crowd out the final call, investigation stops and the review proceeds with partial coverage instead of failing.
- `src/features/reviews/inngest/review-agent.ts` (`budgetStopped = allowance <= 0 && step.toolCalls.length > 0;`): A step without tool calls ends the investigation on its own.
- `src/features/reviews/inngest/review-investigation.ts` (`export async function investigate(`): Investigates the whole pull request, or one part of it when `part` is set. A part sees its own patches; other changed files are listed without them. Every investigation returns the same report shape.
- `src/features/reviews/inngest/review-investigation.ts` (`export function summarizePart(`): Serializable result of one part. Findings are validated against the lines this part delivered, and only cited lines cross into synthesis.
- `src/features/reviews/inngest/review-pull-request.ts` (`const MAX_REVIEW_PARTS = 4;`): A diff beyond one model context is reviewed in at most this many parts.
- `src/features/reviews/inngest/review-pull-request.ts` (`const SAVE_FILES_BATCH_CHARS = 2_000_000;`): Stays well under Convex's per-call argument size limit.
- `src/features/reviews/inngest/review-pull-request.ts` (`const { diffs, ...pinned } = loaded;`): Display patches go straight to Convex so they stay out of step state.
- `src/features/reviews/inngest/review-pull-request.ts` (`let summaries: PartSummary[] = [];`): A diff too large for one model context is split into bounded parts, each investigated in its own step. A tool-free synthesis call then merges their summaries, citing only evidence the parts inspected.
- `src/features/reviews/inngest/review-run.ts` (`export type PartReport = {`): What one investigation produced, with full in-memory evidence. Durable steps must not return this shape; use `PartSummary` across step boundaries.
- `src/features/reviews/inngest/review-synthesis.ts` (`export async function synthesizeParts(`): Merges part summaries into one report, tool-free. Evidence is only the lines the parts cited, so the merged findings are checked against what the parts actually inspected.
- `src/features/reviews/lib/chatgpt-review.ts` (`export function malformedReview(): ReviewOutput {`): Stands in for a final review whose structure is unusable; coverage is kept by the caller.
- `src/features/reviews/lib/chatgpt-review.ts` (`export async function runChatGPTReview({`): Investigation ends early, rather than failing, when another turn could leave no room for the final review call.
- `src/features/reviews/lib/context-budget.ts` (`const TURN_RESERVE_TOKENS = 16_000;`): One investigation turn's output plus tool results the repository reader does not meter, such as file listings and changed-line anchors.
- `src/features/reviews/lib/context-budget.ts` (`export function estimateTokens(text: string) {`): Modern OpenAI BPE is a closer estimate for source and JSON than byte length. Other providers can tokenize differently; keep 15% headroom here and use provider-reported usage after each call. Special-token strings in source are ordinary text, never control tokens.
- `src/features/reviews/lib/context-budget.ts` (`let tokens = 0;`): Bound BPE work on untrusted, repetitive lines. Chunk boundaries may add tokens, which is conservative for the context budget.
- `src/features/reviews/lib/context-budget.ts` (`const slug = chatGPTReviewSlug(modelId);`): ChatGPT subscription slugs match OpenAI's catalog ids on OpenRouter.
- `src/features/reviews/lib/context-budget.ts` (`export function createReviewContextBudget({`): Owns one review's context accounting across investigation and final calls. Adapters translate usage and transcript additions; they do not track tokens.
- `src/features/reviews/lib/context-budget.ts` (`prepareFinal(additionalInput?: unknown[]) {`): An oversized first final call fails; an oversized correction is skipped.
- `src/features/reviews/lib/github-context.ts` (`const MAX_DISPLAY_PATCH_CHARS = 400_000;`): Keeps one stored diff well under Convex's 1 MiB document limit.
- `src/features/reviews/lib/github-context.ts` (`export function assignReviewParts(`): Packs patch sizes into at most `maxParts` model contexts of `capacity` tokens each. Files stay in listing order, so neighbouring paths share a part; once every part is open, later files take any part with room. Returns each file's part, or undefined when its patch is left out.
- `src/features/reviews/lib/github-context.ts` (`for (let page = 1; page <= 2; page++) {`): GitHub listFiles returns 100 per page. A second page handles a concurrent increase.
- `src/features/reviews/lib/github-context.ts` (`evidence.set(file.filename, changedLineAnchors(file.patch, "RIGHT"));`): Quoted evidence comes from the head revision only. Deleted anchors may still cite other head files to explain a regression caused by removal.
