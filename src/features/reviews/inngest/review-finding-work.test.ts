// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { getFunctionName } from "convex/server";
import { expect, test, vi } from "vitest";
import { api, internal } from "../../../../convex/_generated/api";
import schema from "../../../../convex/schema";
import { DEFAULT_CODING_MODEL_ID } from "../../../../convex/lib/coding_models";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
  github: vi.fn(),
  generate: vi.fn(),
  open: vi.fn(),
  stop: vi.fn(),
  capability: vi.fn(),
  quote: vi.fn(),
}));
vi.mock("@/lib/convex-client", () => ({ getConvexAdminClient: () => mocks }));
vi.mock("@/lib/github", () => ({
  createUserOctokit: mocks.github,
  getGithubToken: async () => "server-only-secret",
}));
vi.mock("@/lib/openrouter", () => ({
  openRouter: { chat: () => "fake-model" },
}));
vi.mock("@/inngest/client", () => ({
  inngest: { createFunction: (_config: unknown, handler: unknown) => handler },
}));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: mocks.generate,
}));
vi.mock("../lib/execution-provider", async (original) => ({
  ...(await original<typeof import("../lib/execution-provider")>()),
  openIsolatedRepository: mocks.open,
  executionCapability: mocks.capability,
}));
vi.mock("../lib/finding-budget", async (original) => ({
  ...(await original<typeof import("../lib/finding-budget")>()),
  quoteFindingModel: mocks.quote,
}));
import { SourceVerificationError } from "../lib/execution-provider";
import { reviewFindingWork } from "./review-finding-work";
const modules = import.meta.glob("../../../../convex/**/*.ts");
test.each([
  "discussion",
  "investigation",
  "supported",
  "cost-limit",
  "time-limit",
  "retry-static",
  "comparison-unavailable",
  "comparison-changed",
  "cancel-generating",
  "cancel-testing",
  "inconclusive",
  "oversize",
  "truncated",
  "unknown-size",
  "runner-unavailable",
  "static-supported",
  "deadline-at-finish",
  "superseded-at-finish",
])(
  "durable %s worker saves validated retraction through real owner-scoped persistence",
  async (label) => {
    vi.resetAllMocks();
    mocks.capability.mockResolvedValue({
      available: label !== "runner-unavailable" && label !== "static-supported",
      reason: "Isolated runner unavailable on this host",
    });
    mocks.quote.mockImplementation(async () => ({
      inputMicrosPerToken: 1,
      outputMicrosPerToken: 1,
      quotedAt: Date.now(),
    }));
    // Without a runner or within the size limit, no check can execute.
    const staticOnly = [
      "oversize",
      "truncated",
      "unknown-size",
      "runner-unavailable",
      "static-supported",
    ].includes(label);
    const kind = label === "discussion" ? "discussion" : "investigation";
    const proposing = [
      "supported",
      "static-supported",
      "cost-limit",
      "time-limit",
      "cancel-generating",
      "cancel-testing",
    ].includes(label);
    const verdict = proposing
      ? "supported"
      : label === "inconclusive" || label === "truncated"
        ? "inconclusive"
        : "incorrect";
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "alice" });
    const reviewId = await t.run((ctx) =>
      ctx.db.insert("reviews", {
        ownerId: "alice",
        repoOwner: "upstream",
        repoName: "app",
        pullNumber: 7,
        url: "https://github.com/upstream/app/pull/7",
        status: "completed",
        model: DEFAULT_CODING_MODEL_ID,
        instructions: "",
        progress: "Complete",
        updatedAt: 0,
        headSha: "head",
        baseSha: "base",
        sourceOwner: "fork",
        sourceRepo: "app",
        result: {
          summary: "Review",
          outdated: false,
          coverage: {
            changedFiles: 1,
            diffFiles: ["auth.ts"],
            filesRead: [],
            warnings: [],
          },
          findings: [
            {
              id: "finding",
              title: "Null user",
              severity: "high",
              path: "auth.ts",
              line: 1,
              side: "RIGHT",
              explanation: "Could throw",
              suggestion: "Check null",
              evidence: [],
              previousFindingId: null,
            },
          ],
        },
      }),
    );
    const { workId } =
      kind === "discussion"
        ? await alice.mutation(api.reviewInteractions.discuss, {
            reviewId,
            findingId: "finding",
            requestId: "request-123",
            body: "Check caller",
          })
        : await t.mutation(internal.reviewFindingJobs.investigate, {
            ownerId: "alice",
            reviewId,
            findingId: "finding",
            requestId: "request-123",
            model: DEFAULT_CODING_MODEL_ID,
            maxDurationMs: 300_000,
            maxCostMicros: 2_000_000,
            price: {
              inputMicrosPerToken: 1,
              outputMicrosPerToken: 1,
              quotedAt: Date.now(),
            },
          });
    let materialized = false;
    if (label === "retry-static") {
      const first = await t.mutation(internal.reviewFindingJobs.claim, {
        workId,
        ownerId: "alice",
      });
      await t.mutation(internal.reviewFindingJobs.saveCheck, {
        workId,
        attempt: first!,
        check: {
          command: ["node", "--test"],
          status: "failed",
          output: "Previous attempt",
          sourceSha: "head",
        },
      });
      await alice.mutation(api.reviewInteractions.cancel, { workId });
      await alice.mutation(api.reviewInteractions.retry, { workId });
    }
    mocks.open.mockResolvedValue({
      executionUnit:
        "meteroite-review-00000000-0000-0000-0000-000000000000.service",
      stop: mocks.stop,
      verifyFiles: async () => {
        if (label === "comparison-unavailable")
          throw new SourceVerificationError(
            "unavailable",
            "Comparison infrastructure could not finish",
          );
        if (label === "comparison-changed")
          throw new SourceVerificationError(
            "changed",
            "Pinned file content changed",
          );
      },
      replaceFiles: async () => {
        materialized = true;
      },
      run: async (command: string[]) => {
        if (materialized && label === "cancel-testing")
          await alice.mutation(api.reviewInteractions.cancel, { workId });
        return {
          command,
          status: command[0] === "python" ? "unavailable" : "failed",
          exitCode: 1,
          output: "fixture assertion failed",
          sourceSha: "head",
        };
      },
    });
    mocks.query.mockImplementation((ref, args) => t.query(ref, args));
    mocks.mutation.mockImplementation(async (ref, args) => {
      if (getFunctionName(ref) === "reviewFindingJobs:finish") {
        if (label === "deadline-at-finish")
          await t.run((ctx) =>
            ctx.db.patch("reviewFindingWork", workId, {
              deadline: Date.now() - 1,
            }),
          );
        if (label === "superseded-at-finish") {
          await alice.mutation(api.reviewInteractions.cancel, { workId });
          await alice.mutation(api.reviewInteractions.retry, { workId });
          await t.mutation(internal.reviewFindingJobs.claim, {
            workId,
            ownerId: "alice",
            generation: 1,
          });
        }
      }
      return t.mutation(ref, args);
    });
    mocks.github.mockResolvedValue({
      graphql: vi.fn(),
      rest: {
        pulls: {
          get: async () => ({
            data: {
              head: {
                sha: "head",
                ref: "feature",
                repo: { owner: { login: "fork" }, name: "app" },
              },
            },
          }),
        },
        git: {
          getTree: async () => ({
            data: {
              truncated: label === "truncated",
              tree: [
                {
                  type: "blob",
                  mode: "100644",
                  path: "caller.ts",
                  sha: "blob",
                  size: 30,
                },
                ...(label === "oversize" || label === "unknown-size"
                  ? [
                      {
                        type: "blob",
                        mode: "100644",
                        path: "fixtures/large.bin",
                        sha: "large",
                        size: label === "oversize" ? 10000001 : undefined,
                      },
                    ]
                  : []),
              ],
            },
          }),
          getBlob: async () => ({
            data: {
              encoding: "base64",
              content: Buffer.from("if (!user) return;").toString("base64"),
            },
          }),
        },
      },
    });
    mocks.generate
      .mockImplementationOnce(async ({ tools, prepareStep }) => {
        await prepareStep({ messages: [{ role: "user", content: "Inspect" }] });
        expect(Boolean(tools.runCheck)).toBe(
          kind === "investigation" && !staticOnly,
        );
        if (tools.runCheck && label !== "retry-static")
          await tools.runCheck.execute({ command: ["node", "--test"] });
        const read = tools.readFile.execute({
          revision: "head",
          path: "caller.ts",
          startLine: 1,
          endLine: 1,
        });
        if (label === "truncated")
          await expect(read).rejects.toThrow("truncated");
        else expect((await read).commit).toBe("head");
        return {
          responseMessages: [
            { role: "assistant", content: "Caller guards null." },
          ],
        };
      })
      .mockResolvedValueOnce({
        output: {
          verdict,
          explanation: "Caller rejects null.",
          evidence:
            label === "truncated"
              ? []
              : [
                  {
                    revision: "head",
                    path: "caller.ts",
                    line: 1,
                    quote: "if (!user) return;",
                  },
                ],
          assumptions: [],
        },
      });
    if (proposing)
      mocks.generate.mockImplementationOnce(async ({ prepareStep }) => {
        if (label === "cost-limit") {
          await t.run((ctx) =>
            ctx.db.patch("reviewFindingWork", workId, {
              reservedCostMicros: 2000000 - 1,
            }),
          );
          await prepareStep({
            messages: [{ role: "user", content: "Generate proposal" }],
          });
        }
        if (label === "time-limit")
          await t.run((ctx) =>
            ctx.db.patch("reviewFindingWork", workId, {
              deadline: Date.now() - 1,
            }),
          );
        if (label === "cancel-generating")
          await alice.mutation(api.reviewInteractions.cancel, { workId });
        return {
          output: {
            rationale: "Guard null in this finding",
            files: [
              { path: "caller.ts", replacement: "if (!user) return false;\n" },
            ],
            checks: [
              ["node", "--test"],
              ["python", "check.py"],
            ],
          },
        };
      });
    const run = reviewFindingWork as unknown as (ctx: {
      event: { data: { workId: string; ownerId: string; generation: number } };
      step: { run: <T>(id: string, fn: () => Promise<T>) => Promise<T> };
    }) => Promise<unknown>;
    if (["deadline-at-finish", "superseded-at-finish"].includes(label)) {
      await expect(
        run({
          event: { data: { workId, ownerId: "alice", generation: 0 } },
          step: { run: (_id, fn) => fn() },
        }),
      ).rejects.toThrow(
        label === "deadline-at-finish" ? "deadline" : "superseded",
      );
      const thread = await alice.query(api.reviewInteractions.thread, {
        reviewId,
        findingId: "finding",
      });
      if (label === "deadline-at-finish") {
        expect(thread.work[0].status).toBe("failed");
        expect(thread.work[0].stopReason).toBe("time-limit");
        expect(thread.work[0].result?.verdict).toBe("incorrect");
      } else {
        expect(thread.work[0].status).toBe("running");
        expect(thread.work[0].attempt).toBe(4);
        expect(thread.work[0].dispatchGeneration).toBe(1);
        expect(thread.work[0].stopReason).toBeUndefined();
        expect(thread.work[0].result).toBeUndefined();
      }
      expect(thread.messages.filter((m) => m.role === "assistant")).toEqual([]);
      expect(mocks.stop).toHaveBeenCalled();
      return;
    }
    if (["cost-limit", "time-limit"].includes(label)) {
      await expect(
        run({
          event: { data: { workId, ownerId: "alice", generation: 0 } },
          step: { run: (_id, fn) => fn() },
        }),
      ).rejects.toThrow(label === "cost-limit" ? "cost cap" : "deadline");
      const state = await t.query(internal.reviewFindingJobs.get, {
        workId,
        ownerId: "alice",
      });
      expect(state.work.status).toBe("failed");
      expect(state.work.stopReason).toBe(label);
      expect(state.work.result?.verdict).toBe("supported");
      expect(state.work.proposalError).toBeUndefined();
      expect(
        await alice.query(api.reviewProposals.list, {
          reviewId,
          findingId: "finding",
        }),
      ).toHaveLength(0);
      expect(mocks.stop).toHaveBeenCalled();
      return;
    }
    if (label.startsWith("cancel-")) {
      await expect(
        run({
          event: {
            data: {
              workId,
              ownerId: "alice",
              generation: label === "retry-static" ? 1 : 0,
            },
          },
          step: { run: (_id, fn) => fn() },
        }),
      ).rejects.toThrow("cancelled");
      expect(
        await alice.query(api.reviewProposals.list, {
          reviewId,
          findingId: "finding",
        }),
      ).toHaveLength(0);
      const state = await t.query(internal.reviewFindingJobs.get, {
        workId,
        ownerId: "alice",
      });
      expect(state.work.status).toBe("cancelled");
      expect(state.work.stopReason).toBe("cancelled");
      expect(state.work.result?.verdict).toBe("supported");
      expect(mocks.stop).toHaveBeenCalled();
      return;
    }
    await run({
      event: {
        data: {
          workId,
          ownerId: "alice",
          generation: label === "retry-static" ? 1 : 0,
        },
      },
      step: { run: (_id, fn) => fn() },
    });
    const thread = await alice.query(api.reviewInteractions.thread, {
      reviewId,
      findingId: "finding",
    });
    expect(thread.work[0].status).toBe("completed");
    if (label === "retry-static") {
      expect(thread.work[0].checks).toEqual([]);
      expect(thread.attempts[0].checks[0].status).toBe("failed");
    }
    if (staticOnly) {
      expect(mocks.open).not.toHaveBeenCalled();
      expect(thread.work[0].checks).toEqual([
        {
          command: [],
          status: "unavailable",
          output:
            label.startsWith("runner-") || label === "static-supported"
              ? "Isolated runner unavailable on this host"
              : expect.stringContaining("size limit"),
          sourceSha: "head",
        },
      ]);
    } else if (kind === "investigation" && label !== "retry-static") {
      expect(thread.work[0].checks?.[0].status).toBe(
        label.startsWith("comparison-") ? "unavailable" : "failed",
      );
      if (label === "comparison-unavailable") {
        expect(thread.work[0].checks?.[0].output).toContain(
          "Source comparison was unavailable",
        );
        expect(thread.work[0].checks?.[0].output).not.toContain(
          "This command changed",
        );
      }
      if (label === "comparison-changed")
        expect(thread.work[0].checks?.[0].output).toContain(
          "This command changed pinned source",
        );
      expect(thread.work[0].reservedCostMicros).toBeGreaterThan(0);
      expect(mocks.stop).toHaveBeenCalled();
    }
    const proposals = await alice.query(api.reviewProposals.list, {
      reviewId,
      findingId: "finding",
    });
    expect(proposals).toHaveLength(
      label === "supported" || label === "static-supported" ? 1 : 0,
    );
    if (label === "static-supported")
      expect(proposals[0].checks).toEqual([
        expect.objectContaining({
          status: "unavailable",
          output: "Isolated runner unavailable on this host",
        }),
      ]);
    if (label === "supported") {
      expect(proposals[0].files[0]).toMatchObject({
        expectedBlobSha: "blob",
        original: "if (!user) return;",
        replacement: "if (!user) return false;\n",
      });
      expect(proposals[0].checks[0].status).toBe("failed");
      expect(proposals[0].checks[1].status).toBe("unavailable");
      await expect(
        t
          .withIdentity({ subject: "bob" })
          .query(api.reviewProposals.list, { reviewId, findingId: "finding" }),
      ).rejects.toThrow("Review not found");
    }
    expect(
      (await mocks.github.mock.results[0].value).graphql,
    ).not.toHaveBeenCalled();
    expect(thread.messages.at(-1)?.conclusion).toEqual({
      verdict,
      explanation: "Caller rejects null.",
      evidence:
        label === "truncated"
          ? []
          : [
              {
                revision: "head",
                path: "caller.ts",
                line: 1,
                quote: "if (!user) return;",
                commit: "head",
                blobSha: "blob",
              },
            ],
      assumptions: [
        kind === "discussion" ||
        label === "retry-static" ||
        staticOnly ||
        label.startsWith("comparison-")
          ? "Static inspection only. No tests or runtime checks ran."
          : "Runtime checks are limited to the commands and results recorded with this investigation.",
      ],
    });
  },
);
