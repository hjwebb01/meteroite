// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { getFunctionName } from "convex/server";
import {
  ApplicationBlockedError,
  applicationAction,
} from "../../../../../convex/lib/review_application";
import { beforeEach, expect, test, vi } from "vitest";
import type { Octokit } from "octokit";
import schema from "../../../../../convex/schema";
import { api, internal } from "../../../../../convex/_generated/api";
import { proposalDigest } from "@/features/reviews/lib/finding-proposal";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  mutation: vi.fn(),
  query: vi.fn(),
  send: vi.fn(),
  github: vi.fn(),
}));
vi.mock("@/lib/convex-auth", () => ({ getConvexAuth: mocks.auth }));
vi.mock("convex/nextjs", () => ({ fetchMutation: mocks.mutation }));
vi.mock("@/lib/convex-client", () => ({
  getConvexAdminClient: () => ({
    mutation: mocks.mutation,
    query: mocks.query,
  }),
}));
vi.mock("@/inngest/client", () => ({
  inngest: {
    send: mocks.send,
    createFunction: (_config: unknown, handler: unknown) => handler,
  },
}));
vi.mock("@/features/reviews/lib/github-application", async (original) => ({
  ...(await original<
    typeof import("@/features/reviews/lib/github-application")
  >()),
  githubApplicationClient: mocks.github,
}));
import { POST } from "./route";
import { applyReviewProposal } from "@/features/reviews/inngest/apply-review-proposal";
const modules = import.meta.glob("../../../../../convex/**/*.ts");
beforeEach(() => vi.resetAllMocks());
type RemoteMode =
  | "normal"
  | "read-only"
  | "scope"
  | "private-scope"
  | "workflow-scope"
  | "stale"
  | "target-changed"
  | "race"
  | "lost-reply"
  | "write-failed"
  | "wrong-contents"
  | "extra-change"
  | "disconnected";
async function fixture(mode: RemoteMode = "normal") {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({ subject: "alice" });
  const path =
    mode === "workflow-scope" ? ".github/workflows/check.yml" : "file.js";
  const files = [
    {
      path,
      expectedBlobSha: "old-blob",
      original: "old\n",
      replacement: "new\n",
    },
  ];
  const digest = proposalDigest("source", files);
  const proposalId = await t.run(async (ctx) => {
    const reviewId = await ctx.db.insert("reviews", {
      ownerId: "alice",
      url: "https://github.com/upstream/app/pull/7",
      repoOwner: "upstream",
      repoName: "app",
      pullNumber: 7,
      model: "openai/gpt-6-luna",
      instructions: "",
      status: "completed",
      progress: "Complete",
      updatedAt: 0,
      headSha: "source",
      baseSha: "base",
      sourceOwner: "fork",
      sourceRepo: "app",
    });
    const workId = await ctx.db.insert("reviewFindingWork", {
      ownerId: "alice",
      reviewId,
      findingId: "finding",
      requestId: "request-123",
      kind: "investigation",
      model: "openai/gpt-6-luna",
      status: "completed",
      attempt: 1,
      body: "Investigate",
      headSha: "source",
      baseSha: "base",
      sourceOwner: "fork",
      sourceRepo: "app",
      maxDurationMs: 300000,
      maxCostMicros: 2000000,
      reservedCostMicros: 100000,
      createdAt: 0,
      updatedAt: 0,
      progress: "Complete",
    });
    return ctx.db.insert("reviewProposals", {
      ownerId: "alice",
      reviewId,
      workId,
      findingId: "finding",
      attempt: 1,
      sourceSha: "source",
      sourceOwner: "fork",
      sourceRepo: "app",
      sourceBranch: "feature",
      digest,
      files,
      rationale: "Narrow fix",
      investigation: {
        verdict: "supported",
        explanation: "Premise supported",
        evidence: [],
        assumptions: [],
      },
      checks: [
        {
          command: ["node", "--test"],
          status: "failed",
          exitCode: 1,
          output: "Assertion failed",
          sourceSha: "source",
        },
      ],
      createdAt: 0,
    });
  });
  let head = mode === "stale" ? "newer" : "source";
  let remoteMessage = "";
  let remoteCommitted = false;
  let beforeWrite: (() => Promise<void>) | undefined;
  const expectedTarget = { owner: "fork", repo: "app" };
  const graphql = vi.fn(
    async (
      _query: unknown,
      {
        input,
      }: {
        input: {
          expectedHeadOid: string;
          branch: { repositoryNameWithOwner: string; refName: string };
          message: { body: string };
          fileChanges: { additions: Array<{ path: string; contents: string }> };
        };
      },
    ) => {
      const rows = await t.run((ctx) =>
        ctx.db.query("reviewApplications").collect(),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("writing");
      expect(rows[0].remoteStartedAt).toBeDefined();
      expect(input.branch).toEqual({
        repositoryNameWithOwner: "fork/app",
        refName: "feature",
      });
      expect(input.expectedHeadOid).toBe("source");
      expect(input.fileChanges.additions).toEqual([
        { path, contents: Buffer.from("new\n").toString("base64") },
      ]);
      await beforeWrite?.();
      if (mode === "race") head = "concurrent";
      if (head !== input.expectedHeadOid)
        throw new Error("Expected head does not match");
      if (mode === "write-failed") throw new Error("GitHub unavailable");
      remoteMessage = input.message.body;
      remoteCommitted = true;
      head = "applied";
      if (mode === "lost-reply")
        throw new Error("Response lost after GitHub commit");
      return {
        createCommitOnBranch: {
          commit: {
            oid: "applied",
            url: "https://github.com/fork/app/commit/applied",
          },
        },
      };
    },
  );
  const octokit = {
    graphql,
    rest: {
      pulls: {
        get: async (args: unknown) => {
          expect(args).toEqual({
            owner: "upstream",
            repo: "app",
            pull_number: 7,
          });
          return {
            data: {
              state: "open",
              head: {
                sha: head,
                ref: mode === "target-changed" ? "other" : "feature",
                repo: { owner: { login: "fork" }, name: "app" },
              },
            },
          };
        },
      },
      repos: {
        get: async (args: unknown) => {
          expect(args).toEqual(expectedTarget);
          return {
            data: {
              private: mode === "private-scope",
              permissions: { push: mode !== "read-only" },
            },
            headers: {},
          };
        },
        listCommits: async () => ({
          data: remoteCommitted
            ? [
                {
                  sha: "applied",
                  html_url: "https://github.com/fork/app/commit/applied",
                  commit: { message: remoteMessage },
                },
                { sha: "source", commit: { message: "original" } },
              ]
            : [{ sha: head, commit: { message: "original" } }],
        }),
      },
      git: {
        getRef: async (args: unknown) => {
          expect(args).toEqual({ ...expectedTarget, ref: "heads/feature" });
          return { data: { object: { sha: head } } };
        },
        getCommit: async () => ({
          data: {
            parents: [{ sha: "source" }],
            message: remoteMessage,
            tree: { sha: "applied-tree" },
          },
        }),
        getTree: async ({ tree_sha }: { tree_sha: string }) => ({
          data: {
            truncated: false,
            tree: [
              {
                type: "blob",
                mode: "100644",
                path,
                sha: tree_sha === "applied-tree" ? "new-blob" : "old-blob",
                size: 4,
              },
              ...(mode === "extra-change" && tree_sha === "applied-tree"
                ? [
                    {
                      type: "blob",
                      mode: "100644",
                      path: "unexpected.js",
                      sha: "extra",
                      size: 3,
                    },
                  ]
                : []),
            ],
          },
        }),
        getBlob: async ({ file_sha }: { file_sha: string }) => ({
          data: {
            encoding: "base64",
            content: Buffer.from(
              file_sha === "old-blob"
                ? "old\n"
                : mode === "wrong-contents"
                  ? "wrong\n"
                  : "new\n",
            ).toString("base64"),
          },
        }),
      },
    },
  } as unknown as Octokit;
  mocks.auth.mockResolvedValue({ userId: "alice", token: "jwt" });
  mocks.mutation.mockImplementation((ref, args) =>
    ["reviewApplications:apply", "reviewApplications:dispatchFailed"].includes(
      getFunctionName(ref),
    )
      ? owner.mutation(ref, args)
      : t.mutation(ref, args),
  );
  mocks.query.mockImplementation((ref, args) => t.query(ref, args));
  mocks.send.mockResolvedValue({ ids: ["event"] });
  if (mode === "disconnected")
    mocks.github.mockRejectedValue(
      new ApplicationBlockedError("disconnected", "GitHub disconnected"),
    );
  else
    mocks.github.mockResolvedValue({
      octokit,
      scopes: mode === "scope" ? ["read:user"] : ["public_repo"],
    });
  const post = (expectedDigest = digest, requestId = "apply-request") =>
    POST(
      new Request("http://localhost/api/reviews/apply", {
        method: "POST",
        body: JSON.stringify({
          proposalId,
          expectedDigest,
          requestId,
          ownerId: "attacker",
          sourceOwner: "attacker",
        }),
      }),
    );
  const run = async () => {
    const data = mocks.send.mock.calls.at(-1)![0].data;
    return (
      applyReviewProposal as unknown as (ctx: {
        event: { data: typeof data };
        step: { run: <T>(id: string, fn: () => Promise<T>) => Promise<T> };
      }) => Promise<unknown>
    )({ event: { data }, step: { run: (_id, fn) => fn() } });
  };
  const saved = () =>
    t.run((ctx) => ctx.db.query("reviewApplications").collect());
  return {
    t,
    owner,
    proposalId,
    digest,
    post,
    run,
    saved,
    graphql,
    pauseWrite: (callback: () => Promise<void>) => {
      beforeWrite = callback;
    },
    head: () => head,
  };
}
test("authenticated explicit apply commits exact fork target with CAS, preserves assessment and deduplicates repeated requests", async () => {
  const f = await fixture();
  expect((await f.post()).status).toBe(202);
  expect(mocks.send.mock.calls[0][0].data.ownerId).toBe("alice");
  await f.run();
  expect((await f.saved())[0]).toMatchObject({
    status: "applied",
    commitSha: "applied",
    commitUrl: "https://github.com/fork/app/commit/applied",
  });
  expect(f.head()).toBe("applied");
  expect((await f.post()).status).toBe(202);
  expect((await f.post(f.digest, "second-request")).status).toBe(202);
  expect(f.graphql).toHaveBeenCalledTimes(1);
  expect(await f.saved()).toHaveLength(1);
  const proposal = await f.t.run((ctx) =>
    ctx.db.get("reviewProposals", f.proposalId),
  );
  expect(
    (await f.owner.query(api.reviews.get, { id: proposal!.reviewId })).headSha,
  ).toBe("source");
});
test.each([
  "read-only",
  "scope",
  "private-scope",
  "workflow-scope",
  "stale",
  "target-changed",
  "disconnected",
] as RemoteMode[])(
  "%s target blocks before any GitHub mutation and retains proposal",
  async (mode) => {
    const f = await fixture(mode);
    await f.post();
    await f.run();
    expect((await f.saved())[0].status).toBe("blocked");
    expect(f.graphql).not.toHaveBeenCalled();
    expect(
      await f.t.run((ctx) => ctx.db.get("reviewProposals", f.proposalId)),
    ).not.toBeNull();
  },
);
test.each([
  "race",
  "write-failed",
  "wrong-contents",
  "extra-change",
] as RemoteMode[])(
  "%s write remains uncertain and never fabricates a verified commit",
  async (mode) => {
    const f = await fixture(mode);
    await f.post();
    await f.run();
    expect((await f.saved())[0]).toMatchObject({ status: "uncertain" });
    expect((await f.saved())[0].commitSha).toBeUndefined();
    if (mode === "race") expect(f.head()).toBe("concurrent");
  },
);
test("lost success reply reconciles marker, exact parent/files and branch membership before retry without a duplicate commit", async () => {
  const f = await fixture("lost-reply");
  await f.post();
  await f.run();
  expect((await f.saved())[0].status).toBe("uncertain");
  await f.post();
  const retrying = (await f.saved())[0];
  await f.t.mutation(internal.reviewApplications.fail, {
    applicationId: retrying._id,
    generation: 0,
    error: "late old callback",
  });
  expect((await f.saved())[0].status).toBe("queued");
  expect(
    await f.t.mutation(internal.reviewApplications.claim, {
      applicationId: retrying._id,
      ownerId: "alice",
      generation: 0,
    }),
  ).toBe(false);
  await f.run();
  expect((await f.saved())[0].status).toBe("applied");
  expect(f.graphql).toHaveBeenCalledTimes(1);
});
test("owner and displayed digest are required; failed dispatch is recoverable from one durable intent", async () => {
  const f = await fixture();
  expect((await f.post("0".repeat(64))).status).toBe(409);
  expect(await f.saved()).toHaveLength(0);
  mocks.send.mockRejectedValueOnce(new Error("dispatch unavailable"));
  expect((await f.post()).status).toBe(503);
  expect((await f.saved())[0]).toMatchObject({
    status: "blocked",
    blockReason: "transient",
  });
  expect((await f.post()).status).toBe(202);
  expect(await f.saved()).toHaveLength(1);
  await f.run();
  mocks.auth.mockResolvedValue(null);
  expect((await f.post()).status).toBe(401);
  await expect(
    f.t
      .withIdentity({ subject: "bob" })
      .mutation(api.reviewApplications.apply, {
        proposalId: f.proposalId,
        expectedDigest: f.digest,
        requestId: "bob-request",
      }),
  ).rejects.toThrow("Proposal not found");
});

test("queued and in-flight writes cannot dispatch or supersede the active generation", async () => {
  const f = await fixture();
  await f.post();
  expect(await (await f.post(f.digest, "queued-repeat")).json()).toMatchObject({
    dispatch: false,
  });
  expect(mocks.send).toHaveBeenCalledTimes(1);
  let release!: () => void;
  let entered!: () => void;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.pauseWrite(async () => {
    entered();
    await paused;
  });
  const pending = f.run();
  await writing;
  expect((await f.saved())[0]).toMatchObject({
    status: "writing",
    generation: 0,
  });
  expect(applicationAction((await f.saved())[0])).toBe("wait");
  expect(
    await (await f.post(f.digest, "mid-write-repeat")).json(),
  ).toMatchObject({ dispatch: false, generation: 0 });
  expect(mocks.send).toHaveBeenCalledTimes(1);
  release();
  expect(await pending).toMatchObject({ commitSha: "applied" });
  expect((await f.saved())[0]).toMatchObject({
    status: "applied",
    generation: 0,
    commitSha: "applied",
  });
  expect(f.graphql).toHaveBeenCalledTimes(1);
});

test("expiry fences a pending writer and retry reconciles its landed commit before confirming durable success", async () => {
  const f = await fixture();
  await f.post();
  let release!: () => void;
  let entered!: () => void;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.pauseWrite(async () => {
    entered();
    await paused;
  });
  const pending = f.run();
  await writing;
  const application = (await f.saved())[0];
  await f.t.run((ctx) =>
    ctx.db.patch("reviewApplications", application._id, {
      deadline: Date.now() - 10,
      updatedAt: Date.now() - 10,
    }),
  );
  await f.t.mutation(internal.reviewApplications.expire, {});
  expect((await f.saved())[0]).toMatchObject({
    status: "uncertain",
    generation: 1,
    blockReason: "uncertain",
  });
  release();
  expect(await pending).toMatchObject({ superseded: true });
  expect((await f.saved())[0].commitSha).toBeUndefined();
  await f.post();
  expect((await f.saved())[0]).toMatchObject({
    status: "queued",
    generation: 2,
  });
  expect(await f.run()).toMatchObject({ commitSha: "applied" });
  expect((await f.saved())[0]).toMatchObject({
    status: "applied",
    commitSha: "applied",
    generation: 2,
  });
  expect(f.graphql).toHaveBeenCalledTimes(1);
});

test.each(["stale", "target-changed"] as RemoteMode[])(
  "%s proposals offer reassessment and refuse futile retry",
  async (mode) => {
    const f = await fixture(mode);
    await f.post();
    await f.run();
    const application = (await f.saved())[0];
    expect(application).toMatchObject({
      status: "blocked",
      blockReason: "stale",
    });
    expect(applicationAction(application)).toBe("reassess");
    expect((await f.post()).status).toBe(409);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  },
);

test.each([
  ["read-only", "permission"],
  ["scope", "scope"],
  ["disconnected", "disconnected"],
] as const)(
  "%s remains retryable with an actionable reason",
  async (mode, reason) => {
    const f = await fixture(mode);
    await f.post();
    await f.run();
    const application = (await f.saved())[0];
    expect(application.blockReason).toBe(reason);
    expect(applicationAction(application)).toBe("retry");
    expect((await f.post()).status).toBe(202);
    expect((await f.saved())[0]).toMatchObject({
      status: "queued",
      generation: 1,
    });
  },
);

test("dispatch failure recovery remains owner scoped and cannot interrupt a claimed worker", async () => {
  const f = await fixture();
  await f.post();
  const application = (await f.saved())[0];
  await expect(
    f.t
      .withIdentity({ subject: "bob" })
      .mutation(api.reviewApplications.dispatchFailed, {
        applicationId: application._id,
        generation: 0,
      }),
  ).rejects.toThrow("Application not found");
  await f.t.mutation(internal.reviewApplications.claim, {
    applicationId: application._id,
    ownerId: "alice",
    generation: 0,
  });
  await f.owner.mutation(api.reviewApplications.dispatchFailed, {
    applicationId: application._id,
    generation: 0,
  });
  expect((await f.saved())[0]).toMatchObject({
    status: "running",
    generation: 0,
  });
});
