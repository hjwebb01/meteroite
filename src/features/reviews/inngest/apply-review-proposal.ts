import { ApplicationBlockedError } from "../../../../convex/lib/review_application";
import { inngest } from "@/inngest/client";
import { getConvexAdminClient } from "@/lib/convex-client";
import { internal } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  githubApplicationClient,
  inspectApplicationTarget,
  reconcileApplication,
  commitApplication,
  validateApplication,
  ApplicationWriteRejectedError,
} from "../lib/github-application";
export const applyReviewProposal = inngest.createFunction(
  {
    id: "apply-review-proposal",
    triggers: { event: "review/proposal.apply" },
    retries: 0,
    idempotency: "event.data.dispatchId",
    concurrency: { limit: 1, key: "event.data.applicationId" },
    onFailure: async ({ event, error }) => {
      const { applicationId, generation } = event.data.event.data as {
        applicationId: Id<"reviewApplications">;
        generation: number;
      };
      await getConvexAdminClient().mutation(internal.reviewApplications.fail, {
        applicationId,
        generation,
        error: error.message,
      });
    },
  },
  async ({ event, step }) => {
    const { applicationId, ownerId, generation } = event.data as {
      applicationId: Id<"reviewApplications">;
      ownerId: string;
      generation: number;
    };
    const claimed = await step.run("claim-application", () =>
      getConvexAdminClient().mutation(internal.reviewApplications.claim, {
        applicationId,
        ownerId,
        generation,
      }),
    );
    if (!claimed) return { applicationId, skipped: true };
    return step.run("apply-inspected-manifest", async () => {
      let remoteOutcomeKnown = false;
      try {
        const { application, proposal, review } =
          await getConvexAdminClient().query(internal.reviewApplications.get, {
            applicationId,
            ownerId,
          });
        remoteOutcomeKnown = !application.remoteStartedAt;
        const { octokit, scopes } = await githubApplicationClient(ownerId);
        let confirmed = application.remoteStartedAt
          ? await reconcileApplication(octokit, application, proposal)
          : null;
        if (!confirmed) {
          remoteOutcomeKnown = true;
          const head = await inspectApplicationTarget(
            octokit,
            scopes,
            proposal,
            review,
          );
          if (head !== application.expectedHeadSha)
            throw new ApplicationBlockedError(
              "stale",
              "The source branch advanced. This proposal is stale; start a new review and investigation. No newer work was overwritten.",
            );
          await validateApplication(octokit, application, proposal);
          const writing = await getConvexAdminClient().mutation(
            internal.reviewApplications.writing,
            { applicationId, generation },
          );
          if (!writing)
            throw new Error("Application attempt expired or was superseded");
          remoteOutcomeKnown = false;
          try {
            confirmed = await commitApplication(octokit, application, proposal);
          } catch (error) {
            if (!(error instanceof ApplicationWriteRejectedError)) throw error;
            // Reconcile even a rejection: an earlier attempt may have committed.
            confirmed = await reconcileApplication(
              octokit,
              application,
              proposal,
            );
            if (!confirmed) {
              remoteOutcomeKnown = true;
              const latestHead = await inspectApplicationTarget(
                octokit,
                scopes,
                proposal,
                review,
              );
              if (latestHead !== application.expectedHeadSha)
                throw new ApplicationBlockedError(
                  "stale",
                  "The source branch advanced. Start a new review and investigation. No newer work was overwritten.",
                );
              throw error;
            }
          }
        }
        const saved = await getConvexAdminClient().mutation(
          internal.reviewApplications.finish,
          {
            applicationId,
            generation,
            commitSha: confirmed.sha,
            commitUrl: confirmed.url,
          },
        );
        if (!saved) return { applicationId, superseded: true };
        return { applicationId, commitSha: confirmed.sha };
      } catch (error) {
        await getConvexAdminClient().mutation(
          internal.reviewApplications.fail,
          {
            applicationId,
            generation,
            remoteOutcomeKnown,
            blockReason:
              error instanceof ApplicationBlockedError
                ? error.reason
                : undefined,
            error:
              error instanceof Error
                ? error.message
                : "Application result unavailable",
          },
        );
        return { applicationId, blocked: true };
      }
    });
  },
);
