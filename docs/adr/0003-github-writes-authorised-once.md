# GitHub writes are authorised once and recovered, never blindly retried

A remote write can succeed without us learning of it. Publication and application are authorised in one transaction, the remote result is looked up before any retry, and only explicit rejections count as failure; everything else stays uncertain. These rules were code comments.

## Decisions

- `convex/lib/review_publication.ts` (`export async function publicationSnapshot(`): Read the same latest conclusions used by reviewInteractions.verdicts in one transaction with the saved review. The source binds all eligible content, including content omitted by GitHub's body limit, and explicit exclusions.
- `convex/reviewJobs.ts` (`if (`): A failed lookup says nothing about a previously observed newer branch.
- `convex/reviewPublications.ts` (`export const authorizeWrite = internalMutation({`): This transaction is the authorization point for each exact immutable payload. A conclusion arriving between preview/claim and the remote write invalidates it.
- `convex/reviewPublications.ts` (`export const reset = internalMutation({`): The server must first complete a fresh GitHub lookup with no matching post. Reset is explicitly requested; it never retries the remote write itself.
- `src/app/api/reviews/publish/route.ts` (`const recovered = await findPostedGithubReview(github, review);`): Recovery is read-only and remains possible even when the PR has moved.
- `src/app/api/reviews/publish/route.ts` (`remoteAttempted = false;`): Called before both normal publication and the possible 422 fallback.
- `src/app/api/reviews/publish/route.ts` (`const signal = AbortSignal.timeout(60_000);`): Start the deadline before authorization, so a delayed response cannot resume with a new unbounded remote write after the attempt is reset.
- `src/features/reviews/components/review-publication-preview.tsx` (`setPreview((current) =>`): A lost response can follow a successful write. Require status recovery, not a second blind confirmation using the same preview.
- `src/features/reviews/inngest/apply-review-proposal.ts` (`confirmed = await reconcileApplication(`): Reconcile even a rejection: an earlier attempt may have committed.
- `src/features/reviews/lib/github-application.ts` (`octokit.hook.wrap("request", (request, options) =>`): Each request gets its own 20-second limit; one shared signal would end a long application partway through.
- `src/features/reviews/lib/github-application.ts` (`export class ApplicationWriteRejectedError extends ApplicationBlockedE`): Only explicit rejection responses can resolve a write as unsuccessful. Transport failures, internal errors, and partial commit responses stay uncertain.
- `src/features/reviews/lib/github-application.ts` (`export async function validateApplication(`): Read-only checks, run before the application is marked as writing so a failure here is never reported as an uncertain remote write.
- `src/features/reviews/lib/github-review.test.ts` (`expect(fetch).not.toHaveBeenCalled();`): The custom transport cannot observe browser abort semantics; the helper itself must reject before invoking any transport.
- `src/features/reviews/lib/github-review.ts` (`const MAX_BODY_CHARS = 65_000;`): GitHub rejects review and comment bodies longer than this.
- `src/features/reviews/lib/github-review.ts` (`export function reviewMarker(reviewId: string) {`): Hidden in the rendered review; finds a post whose result was never recorded.
- `src/features/reviews/lib/github-review.ts` (`export function buildGithubReview(`): One GitHub review per saved review: inline comments for main findings, nitpicks folded into the summary. `inline: false` puts every finding in the summary, for when GitHub cannot resolve an inline anchor.
- `src/features/reviews/lib/github-review.ts` (`export async function publishGithubReview(`): Posts the review as a non-blocking COMMENT review on the reviewed commit. The caller must claim publication and check findPostedGithubReview first.
- `src/features/reviews/lib/github-review.ts` (`if (!(error instanceof RequestError && error.status === 422)) throw er`): 422: an anchor no longer resolves, e.g. the commit left the PR.
