import { generateText, isStepCount, Output, tool, type ModelMessage } from "ai";
import type { z } from "zod";
import { NonRetriableError } from "inngest";
import type { Octokit } from "octokit";
import { openRouter } from "@/lib/openrouter";
import { getGithubToken } from "@/lib/github";
import type { Doc } from "../../../../convex/_generated/dataModel";
import type {
  ExecutionAdapter,
  ModelAdapter,
  PinnedSource,
} from "./finding-attempt";
import { createFindingReader } from "./finding-evidence";
import { canonicalProposal } from "./finding-proposal";
import {
  executionCapability,
  githubRepositoryUrl,
  openIsolatedRepository,
} from "./execution-provider";

export function openRouterModel(modelId: string): ModelAdapter {
  const model = openRouter.chat(modelId);
  return {
    async explore({ tools, beforeCall, ...call }) {
      const { responseMessages } = await generateText({
        model,
        system: call.system,
        prompt: call.prompt,
        maxOutputTokens: call.maxOutputTokens,
        abortSignal: call.signal,
        stopWhen: isStepCount(4),
        prepareStep: async ({ messages }) => {
          await beforeCall(messages);
          return {};
        },
        tools: Object.fromEntries(
          Object.entries(tools).map(([name, t]) => [
            name,
            tool({
              description: t.description,
              inputSchema: t.inputSchema,
              execute: t.execute,
            } as never),
          ]),
        ),
      });
      return responseMessages;
    },
    async produce({ schema, beforeCall, history, instruction, ...call }) {
      const { output } = await generateText({
        model,
        system: call.system,
        abortSignal: call.signal,
        maxOutputTokens: call.maxOutputTokens,
        output: Output.object({ schema }),
        prepareStep: async ({ messages }) => {
          await beforeCall(messages);
          return {};
        },
        messages: [
          { role: "user", content: call.prompt },
          ...(history as ModelMessage[]),
          { role: "user", content: instruction },
        ],
      });
      return output as z.infer<typeof schema>;
    },
  };
}

export function githubSource(
  octokit: Octokit,
  work: Doc<"reviewFindingWork">,
  review: Doc<"reviews">,
) {
  return async (
    heartbeat: Parameters<typeof createFindingReader>[2],
  ): Promise<PinnedSource> => ({
    reader: await createFindingReader(
      octokit,
      {
        ...work,
        repoOwner: review.repoOwner,
        repoName: review.repoName,
        diffLeftSha: review.diffLeftSha,
      },
      heartbeat,
    ),
    async currentHead() {
      const { data: pr } = await octokit.rest.pulls.get({
        owner: review.repoOwner,
        repo: review.repoName,
        pull_number: review.pullNumber,
      });
      return {
        sha: pr.head.sha,
        owner: pr.head.repo?.owner.login ?? "",
        repo: pr.head.repo?.name ?? "",
        branch: pr.head.ref,
      };
    },
    canonicalize: (change) =>
      canonicalProposal(
        octokit,
        {
          sourceSha: work.headSha,
          sourceOwner: work.sourceOwner,
          sourceRepo: work.sourceRepo,
        },
        change,
      ),
  });
}

export function isolatedExecution(
  octokit: Octokit,
  work: Doc<"reviewFindingWork">,
  ownerId: string,
): ExecutionAdapter {
  return {
    async open(signal) {
      const capability = await executionCapability();
      if (!capability.available) return { limitation: capability.reason };
      const { data: tree } = await octokit.rest.git.getTree({
        owner: work.sourceOwner,
        repo: work.sourceRepo,
        tree_sha: work.headSha,
        recursive: "true",
      });
      if (
        tree.truncated ||
        tree.tree.length > 2000 ||
        tree.tree.some(
          (f) =>
            f.type === "blob" &&
            (!Number.isSafeInteger(f.size) || (f.size ?? -1) < 0),
        ) ||
        tree.tree.reduce((n, f) => n + (f.size ?? 0), 0) > 10_000_000
      )
        return {
          limitation:
            "This checkout exceeds the offline runner size limit, so no checks ran. The investigation used static inspection only.",
        };
      const token = await getGithubToken(ownerId);
      if (!token) throw new NonRetriableError("GitHub is disconnected");
      return {
        runtime: await openIsolatedRepository({
          sourceSha: work.headSha,
          repositoryUrl: githubRepositoryUrl(work.sourceOwner, work.sourceRepo),
          githubToken: token,
          deadline: work.deadline!,
          signal,
        }),
      };
    },
  };
}
