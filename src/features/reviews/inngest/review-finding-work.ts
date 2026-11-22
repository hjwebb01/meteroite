import type { Octokit } from "octokit";
import { findingLease } from "../lib/finding-lease";
import { inngest } from "@/inngest/client";
import { createUserOctokit } from "@/lib/github";
import { getConvexAdminClient } from "@/lib/convex-client";
import { internal } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { runFindingAttempt } from "../lib/finding-attempt";
import {
  githubSource,
  isolatedExecution,
  openRouterModel,
} from "../lib/finding-attempt-adapters";
import { currentFindingPrice } from "../lib/finding-budget";

export const reviewFindingWork = inngest.createFunction(
  {
    id: "review-finding-work",
    triggers: { event: "review/finding.requested" },
    retries: 0,
    idempotency: "event.data.dispatchId",
    concurrency: { limit: 2, key: "event.data.ownerId" },
    cancelOn: [
      {
        event: "review/finding.cancelled",
        if: "event.data.workId == async.data.workId && event.data.generation == async.data.generation",
      },
    ],
    onFailure: async ({ event, error }) => {
      const { workId, generation } = event.data.event.data as {
        workId: Id<"reviewFindingWork">;
        generation?: number;
      };
      await getConvexAdminClient().mutation(internal.reviewFindingJobs.fail, {
        workId,
        generation: generation ?? 0,
        error: error.message,
        stopReason: "infrastructure",
      });
    },
  },
  async ({ event, step }) => {
    const { workId, ownerId, generation } = event.data as {
      workId: Id<"reviewFindingWork">;
      ownerId: string;
      generation?: number;
    };
    const attempt = await step.run("claim-finding-work", () =>
      getConvexAdminClient().mutation(internal.reviewFindingJobs.claim, {
        workId,
        ownerId,
        generation: generation ?? 0,
      }),
    );
    if (attempt === null) return { workId, skipped: true };
    await step.run("inspect-and-respond", () =>
      respondToFinding({
        workId,
        ownerId,
        generation: generation ?? 0,
        attempt,
      }),
    );
    return { workId };
  },
);

async function respondToFinding({
  workId,
  ownerId,
  generation,
  attempt,
}: {
  workId: Id<"reviewFindingWork">;
  ownerId: string;
  generation: number;
  attempt: number;
}) {
  const convex = getConvexAdminClient();
  const { work, review, finding, messages } = await convex.query(
    internal.reviewFindingJobs.get,
    { workId, ownerId },
  );
  let octokit: Promise<Octokit> | undefined;
  const connect = () => (octokit ??= createUserOctokit(ownerId));
  await runFindingAttempt(
    { ownerId, work, review, finding, messages },
    {
      model: openRouterModel(work.model),
      lease: findingLease(convex, { workId, attempt, generation }),
      source: async (heartbeat) =>
        githubSource(await connect(), work, review)(heartbeat),
      execution: {
        open: async (signal) =>
          isolatedExecution(await connect(), work, ownerId).open(signal),
      },
      price: () => currentFindingPrice(work.model, work.price),
      ranChecks: async () => {
        const { work: current } = await convex.query(
          internal.reviewFindingJobs.get,
          { workId, ownerId },
        );
        return (
          current.checks?.some(
            (c) => c.status === "passed" || c.status === "failed",
          ) ?? false
        );
      },
    },
  );
}

export const reviewFindingJanitor = inngest.createFunction(
  { id: "review-finding-janitor", triggers: { cron: "*/1 * * * *" } },
  async ({ step }) => {
    await step.run("expire-finding-work", () =>
      getConvexAdminClient().mutation(internal.reviewFindingJobs.expire, {}),
    );
    await step.run("expire-reviews", () =>
      getConvexAdminClient().mutation(internal.reviewJobs.expireStalled, {}),
    );
    await step.run("expire-applications", () =>
      getConvexAdminClient().mutation(internal.reviewApplications.expire, {}),
    );
    await step.run("remove-expired-checkouts", async () => {
      const { cleanupExpiredCheckouts } =
        await import("../lib/execution-provider");
      await cleanupExpiredCheckouts();
    });
  },
);
