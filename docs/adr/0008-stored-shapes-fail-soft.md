# Stored shapes have one definition and fail soft

A stored shape derives from a single source, malformed model output degrades to an explicit incomplete state, and access failures reveal nothing about other owners' data. These rules were code comments.

## Decisions

- `convex/lib/coding_models.ts` (`export const CODING_MODELS = [`): Models users can pick for the coding agent. IDs are OpenRouter slugs that support tool calling and reasoning. Shared by Convex (validation), the API route, the worker, and the sidebar, so it must stay free of runtime imports.
- `convex/lib/owned_review.ts` (`export async function getOwnedReview(`): Another owner's review is reported as missing so its existence is not revealed.
- `convex/lib/review_assessment.ts` (`const cited = quote.trim();`): Keeps a 500-character path within the 700-character entry limit.
- `convex/lib/review_fields.ts` (`category: v.optional(`): Absent on reviews saved before findings were categorised and scored.
- `convex/lib/zod_validator.ts` (`export function zodValidator<T extends z.ZodType>(`): Derives the Convex validator for a Zod schema so a stored shape has one definition. Bounds and refinements cannot be stored; mutations still parse with the Zod schema before writing.
- `convex/reviewInteractions.ts` (`export const verdicts = query({`): The latest reconsidered verdict per finding, so a retraction stays visible wherever the original claim is shown.
- `src/features/reviews/lib/finding-proposal.ts` (`const byPath = (a: { path: string }, b: { path: string }) =>`): Code-unit order, so the digest does not depend on the runtime's locale.
- `src/features/reviews/lib/finding-triage.ts` (`const DECISIONS_URL = "https://api.openai.com/v1/decisions";`): Second-opinion pass over validated findings using OpenAI's Decisions API. The review model stays the source of findings; triage only withholds confident false positives and duplicates, and corrects severity when sure.
- `src/features/reviews/lib/finding-triage.ts` (`export const TRIAGE_THRESHOLDS = {`): Findings in between are kept: uncertainty favors the review model.
- `src/features/reviews/lib/refusal.ts` (`export function refusalResponse(error: unknown, fallback: string) {`): A refusal is an error written for the user: a ConvexError carrying its message. Anything else is an infrastructure failure, logged on the server and reported without its details.
- `src/features/reviews/lib/review-tools.ts` (`export function describeReviewAction(name: string, args: unknown): str`): One line for the progress view: the tool and the path it touches. Paths come from the pull request, so control characters are replaced and the text is cut.
- `src/features/reviews/lib/review.ts` (`const categorySchema = z`): A missing or unrecognised label only drops the label, never the finding.
- `src/features/reviews/lib/review.ts` (`const side = z.enum(["LEFT", "RIGHT"]);`): The response shapes carry no length or count bounds, so one hotspot or finding that breaks a bound is rejected on its own by validateHotspots or validateFindings instead of failing the whole review.
