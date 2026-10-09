import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { getConvexAdminClient } from "@/lib/convex-client";
import { createUserOctokit } from "@/lib/github";
import { openRouter } from "@/lib/openrouter";
import { internal } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { loadPullRequest } from "../lib/github-context";
import {
  modelProviderForReview,
  type ModelProvider,
} from "@/features/model-provider/model-provider";
import { loadReviewBudget } from "../lib/context-budget";
import { SCRUTINY_RUBRIC } from "../../../../convex/lib/review_assessment";
import { investigate, summarizePart } from "./review-investigation";
import { synthesizeParts } from "./review-synthesis";
import { finalizeReview } from "./review-finalization";
import type { PartSummary, ReviewRun } from "./review-run";

// A diff beyond one model context is reviewed in at most this many parts.
const MAX_REVIEW_PARTS = 4;

// Stays well under Convex's per-call argument size limit.
const SAVE_FILES_BATCH_CHARS = 2_000_000;

function batchBySize<T extends { patch?: string }>(
  items: T[],
  maxChars: number,
) {
  const batches: T[][] = [];
  let size = Infinity;
  for (const item of items) {
    const itemSize = item.patch?.length ?? 0;
    if (size + itemSize > maxChars) {
      batches.push([]);
      size = 0;
    }
    batches.at(-1)!.push(item);
    size += itemSize;
  }
  return batches;
}

export const reviewPullRequest = inngest.createFunction(
  {
    id: "review-pull-request",
    triggers: { event: "review/requested" },
    retries: 1,
    idempotency: "event.data.reviewId",
    concurrency: { limit: 2, key: "event.data.ownerId" },
    cancelOn: [
      {
        event: "review/cancel",
        if: "event.data.reviewId == async.data.reviewId",
      },
    ],
    onFailure: async ({ event, error, step }) => {
      const { reviewId } = event.data.event.data as { reviewId: Id<"reviews"> };
      await step.run("mark-failed", () =>
        getConvexAdminClient().mutation(internal.reviewJobs.fail, {
          id: reviewId,
          error: `The review failed: ${error.message.slice(0, 500)}`,
        }),
      );
    },
  },
  async ({ event, step }) => {
    const { reviewId, ownerId, provider } = event.data as {
      reviewId: Id<"reviews">;
      ownerId: string;
      /** Absent on events queued before Model providers; those use OpenRouter. */
      provider?: ModelProvider;
    };
    const { review, previous, previousFiles } = await step.run(
      "load-review",
      () =>
        getConvexAdminClient().query(internal.reviewJobs.get, {
          id: reviewId,
          ownerId,
        }),
    );
    if (review.status !== "queued" && review.status !== "running") return;
    const modelProvider = modelProviderForReview(review, ownerId, provider);
    const budget = await step.run("load-model-budget", () =>
      loadReviewBudget(review.model),
    );

    const snapshot = await step.run("load-pinned-pr", async () => {
      const active = await getConvexAdminClient().mutation(
        internal.reviewJobs.progress,
        { id: reviewId, progress: "Loading pull request and repository" },
      );
      if (!active) throw new NonRetriableError("Review cancelled");
      const octokit = await createUserOctokit(ownerId);
      let loaded;
      try {
        loaded = await loadPullRequest(
          octokit,
          review.repoOwner,
          review.repoName,
          review.pullNumber,
          budget.diffTokens,
          MAX_REVIEW_PARTS,
        );
      } catch (error) {
        const known =
          error instanceof Error &&
          /^(This PR changes|The PR's source|The PR changed)/.test(
            error.message,
          );
        if (known) {
          await getConvexAdminClient().mutation(internal.reviewJobs.fail, {
            id: reviewId,
            error: (error as Error).message,
          });
          throw new NonRetriableError((error as Error).message);
        }
        throw error;
      }
      const pinnedSuccessfully = await getConvexAdminClient().mutation(
        internal.reviewJobs.pinSnapshot,
        {
          id: reviewId,
          title: loaded.title,
          headSha: loaded.headSha,
          baseSha: loaded.baseSha,
          baseTipSha: loaded.baseTipSha,
          diffLeftSha: loaded.diffLeftSha,
          sourceOwner: loaded.sourceOwner,
          sourceRepo: loaded.sourceRepo,
        },
      );
      if (!pinnedSuccessfully)
        throw new NonRetriableError(
          "The review stopped or its pinned snapshot changed. Start a new review.",
        );
      // Display patches go straight to Convex so they stay out of step state.
      const { diffs, ...pinned } = loaded;
      for (const batch of batchBySize(diffs, SAVE_FILES_BATCH_CHARS))
        await getConvexAdminClient().mutation(internal.reviewJobs.saveFiles, {
          id: reviewId,
          headSha: loaded.headSha,
          baseSha: loaded.baseSha,
          files: batch,
        });
      return pinned;
    });

    const parts = Math.max(
      1,
      ...snapshot.files.map((file) => (file.part ?? 0) + 1),
    );
    const previousFindings = previous?.result?.findings ?? [];
    const checkActive = async () => {
      const status = await getConvexAdminClient().query(
        internal.reviewJobs.status,
        { id: reviewId, ownerId },
      );
      if (status !== "running") throw new NonRetriableError("Review cancelled");
    };
    const run: ReviewRun = {
      reviewId,
      repository: {
        owner: review.repoOwner,
        name: review.repoName,
        pullNumber: review.pullNumber,
      },
      snapshot,
      previous,
      previousFiles,
      previousFindings,
      sharedContext: {
        pullRequest: {
          title: snapshot.title,
          description: snapshot.body,
          headSha: snapshot.headSha,
          baseSha: snapshot.baseSha,
        },
        reviewPreferences: review.instructions,
        assessmentRubric: SCRUTINY_RUBRIC,
        observedSignals: snapshot.signals,
        previousFindings,
      },
      provider:
        modelProvider.kind === "chatgpt"
          ? { chatGPT: modelProvider.selection }
          : { model: openRouter.chat(review.model) },
      budget,
      checkActive,
      prepareFindings: async () => {
        await checkActive();
        await getConvexAdminClient().mutation(internal.reviewJobs.progress, {
          id: reviewId,
          progress: "Checking evidence and preparing findings",
        });
      },
    };
    const reportProgress = async (progress: string) => {
      const active = await getConvexAdminClient().mutation(
        internal.reviewJobs.progress,
        { id: reviewId, progress, title: snapshot.title },
      );
      if (!active) throw new NonRetriableError("Review cancelled");
    };

    /**
     * A diff too large for one model context is split into bounded parts,
     * each investigated in its own step. A tool-free synthesis call then
     * merges their summaries, citing only evidence the parts inspected.
     */
    let summaries: PartSummary[] = [];
    if (parts > 1) {
      summaries = await Promise.all(
        Array.from({ length: parts }, (_, part) =>
          step.run(`investigate-part-${part + 1}`, async () => {
            await reportProgress(
              `Investigating a large change in ${parts} parts`,
            );
            const octokit = await createUserOctokit(ownerId);
            // Parts finish while others still investigate; only synthesis
            // announces that findings are being prepared.
            const partRun = { ...run, prepareFindings: checkActive };
            return summarizePart(
              run,
              await investigate(octokit, partRun, {
                index: part,
                count: parts,
              }),
              part,
            );
          }),
        ),
      );
    }

    const result = await step.run(
      parts === 1 ? "investigate-and-review" : "synthesize-review",
      async () => {
        await reportProgress(
          parts === 1
            ? "Investigating changes and related code"
            : "Combining findings from every part",
        );
        const octokit = await createUserOctokit(ownerId);
        const report =
          parts === 1
            ? await investigate(octokit, run)
            : await synthesizeParts(run, summaries);
        return finalizeReview(
          octokit,
          run,
          report,
          summaries.reduce((total, summary) => total + summary.rejected, 0),
        );
      },
    );
    await step.run("save-review", () =>
      getConvexAdminClient().mutation(internal.reviewJobs.finish, {
        id: reviewId,
        result,
      }),
    );
    return { reviewId };
  },
);
