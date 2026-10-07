// @vitest-environment node
/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../../../convex/schema";
import { DEFAULT_CODING_MODEL_ID } from "../../../../convex/lib/coding_models";
import { api, internal } from "../../../../convex/_generated/api";
import { assessmentCalibrationFixtures } from "../lib/assessment-fixtures";
import { reviewOutputSchema } from "../lib/review";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  github: vi.fn(),
  query: vi.fn(),
  mutation: vi.fn(),
  publicQuery: vi.fn(),
  publicMutation: vi.fn(),
  send: vi.fn(),
  generate: vi.fn(),
}));
vi.mock("@/lib/convex-auth", () => ({ getConvexAuth: mocks.auth }));
vi.mock("@/lib/convex-client", () => ({
  getConvexAdminClient: () => mocks,
  convexDeployKeyProblem: () => null,
}));
vi.mock("@/lib/github", () => ({
  getGithubToken: async () => "fake-github-token",
  createUserOctokit: mocks.github,
}));
vi.mock("convex/nextjs", () => ({
  fetchQuery: mocks.publicQuery,
  fetchMutation: mocks.publicMutation,
}));
vi.mock("@/lib/openrouter", () => ({
  openRouter: { chat: () => "fake-model" },
}));
vi.mock("@/inngest/client", () => ({
  inngest: {
    send: mocks.send,
    createFunction: (_config: unknown, handler: unknown) => handler,
  },
}));
vi.mock("ai", () => ({
  generateText: mocks.generate,
  isStepCount: () => undefined,
  Output: { object: () => undefined },
  tool: (config: unknown) => config,
}));
import { POST } from "../../../app/api/reviews/route";
import { POST as refreshFreshness } from "../../../app/api/reviews/freshness/route";
import { reviewPullRequest } from "./review-pull-request";

const modules = import.meta.glob("../../../../convex/**/*.ts");
let backend: ReturnType<typeof convexTest>;
let authenticated: ReturnType<ReturnType<typeof convexTest>["withIdentity"]>;
let events: { data: { reviewId: string; ownerId: string } }[];
const fixture = assessmentCalibrationFixtures[3];
let output: unknown;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("OPENROUTER_API_KEY", "fake-key");
  vi.stubEnv("CONVEX_DEPLOY_KEY", "fake-key");
  backend = convexTest(schema, modules);
  authenticated = backend.withIdentity({ subject: "alice" });
  mocks.auth.mockResolvedValue({ userId: "alice", token: "fake-user-jwt" });
  mocks.query.mockImplementation((ref, args) => backend.query(ref, args));
  mocks.mutation.mockImplementation((ref, args) => backend.mutation(ref, args));
  mocks.publicQuery.mockImplementation((ref, args) =>
    authenticated.query(ref, args),
  );
  mocks.publicMutation.mockImplementation((ref, args) =>
    authenticated.mutation(ref, args),
  );
  events = [];
  mocks.send.mockImplementation(async (event) => {
    events.push(event);
    return { ids: ["event-id"] };
  });
  const pr = {
    title: fixture.name,
    body: "",
    changed_files: 1,
    draft: false,
    base: { sha: "base" },
    head: { sha: "head", repo: { owner: { login: "alice" }, name: "app" } },
  };
  mocks.github.mockResolvedValue({
    paginate: async () => [{ status: "completed", conclusion: "success" }],
    rest: {
      checks: { listForRef: vi.fn() },
      repos: {
        compareCommitsWithBasehead: async () => ({
          data: {
            merge_base_commit: { sha: "merge-base" },
            files: [
              {
                filename: "README.md",
                sha: "blob",
                status: "modified",
                patch: `@@ -1 +1 @@\n-old behavior\n+${fixture.source}`,
              },
            ],
          },
        }),
        getCombinedStatusForRef: async () => ({
          data: { total_count: 0, state: "pending" },
        }),
      },
      pulls: {
        get: async () => ({ data: pr }),
        listFiles: async () => ({
          data: [
            {
              filename: "README.md",
              sha: "blob",
              status: "modified",
              patch: `@@ -1 +1 @@\n-old behavior\n+${fixture.source}`,
            },
          ],
        }),
      },
      git: {
        getTree: async () => ({
          data: {
            truncated: false,
            tree: [
              {
                type: "blob",
                mode: "100644",
                path: "README.md",
                sha: "blob",
                size: fixture.source.length,
              },
            ],
          },
        }),
        getBlob: async () => ({
          data: {
            encoding: "base64",
            size: fixture.source.length,
            content: Buffer.from(fixture.source).toString("base64"),
          },
        }),
      },
    },
  });
  output = {
    hotspots: [
      {
        kind: "human_judgment",
        title: "Authorization boundary",
        reason:
          "Cross-service authorization deserves human judgment even without a confirmed bug.",
        references: [{ path: "README.md", line: 1, side: "RIGHT" }],
      },
    ],
    summary: fixture.name,
    assessment: fixture.assessment,
    findings: [],
    limitations: ["Execution was not performed."],
  };
  mocks.generate.mockImplementation(async () =>
    mocks.generate.mock.calls.length % 2
      ? { responseMessages: [] }
      : { output: reviewOutputSchema.parse(output) },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ data: [] })),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function startAndRun() {
  const response = await POST(
    new Request("http://localhost/api/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/alice/app/pull/7" }),
    }),
  );
  expect(response.status).toBe(202);
  const { reviewId } = await response.json();
  const handler = reviewPullRequest as unknown as (input: {
    event: (typeof events)[number];
    step: { run: (name: string, callback: () => unknown) => unknown };
  }) => Promise<unknown>;
  await handler({
    event: events.at(-1)!,
    step: { run: (_name, callback) => callback() },
  });
  return authenticated.query(api.reviews.get, { id: reviewId });
}

describe("authenticated persisted review assessment", () => {
  test("a zero-finding sensitive PR keeps high scrutiny, pinned observations and owner isolation", async () => {
    const saved = await startAndRun();
    expect(saved).toMatchObject({
      status: "completed",
      headSha: "head",
      baseSha: "base",
      result: {
        findings: [],
        assessment: {
          state: "complete",
          score: 4,
          readiness: { state: "ready_for_review" },
          signals: {
            draft: { state: "known", value: false, headSha: "head" },
            checks: { state: "known", value: "passed", headSha: "head" },
          },
        },
      },
    });
    expect(saved.diffLeftSha).toBe("merge-base");
    expect(saved.result?.hotspots?.[0].references[0]).toMatchObject({
      commitSha: "head",
      path: "README.md",
      sourcePath: "README.md",
      side: "RIGHT",
    });
    expect(saved.result?.assessment?.coverageReasons).toContain(
      "Execution was not performed.",
    );
    await expect(
      backend
        .withIdentity({ subject: "bob" })
        .query(api.reviews.get, { id: saved._id }),
    ).rejects.toThrow("Review not found");
    expect(JSON.stringify(events)).not.toContain("fake-github-token");
  });
  test("an incomplete model assessment persists without a numeric score", async () => {
    output = {
      hotspots: [
        {
          kind: "human_judgment",
          title: "Authorization boundary",
          reason: "Known sensitive behavior remains visible.",
          references: [{ path: "README.md", line: 1, side: "RIGHT" }],
        },
      ],
      summary: "Evidence unavailable",
      assessment: {
        state: "incomplete",
        missingEvidence: ["The required related source was unavailable."],
      },
      findings: [],
      limitations: [],
    };
    const saved = await startAndRun();
    expect(saved.result?.assessment).toMatchObject({
      state: "incomplete",
      missingEvidence: ["The required related source was unavailable."],
      readiness: { state: "incomplete" },
    });
    expect("score" in saved.result!.assessment!).toBe(false);
    expect(saved.result?.hotspots).toHaveLength(1);
  });
  test("invalid generated ratings persist an honest incomplete assessment", async () => {
    output = {
      hotspots: [],
      summary: "Invalid rating",
      assessment: {
        ...fixture.assessment,
        dimensions: {
          ...fixture.assessment.dimensions,
          impact: { level: 6, reason: "Invalid" },
        },
      },
      findings: [],
      limitations: [],
    };
    const saved = await startAndRun();
    expect(saved.result?.assessment).toMatchObject({
      state: "incomplete",
      readiness: { state: "incomplete" },
    });
  });
  test.each(["missing", "dimension", "evidence"])(
    "malformed %s assessment keeps the saved static review",
    async (kind) => {
      const malformed =
        kind === "missing"
          ? undefined
          : kind === "dimension"
            ? {
                ...fixture.assessment,
                dimensions: { impact: fixture.assessment.dimensions.impact },
              }
            : { ...fixture.assessment, evidence: [] };
      output = {
        summary: "Retained static summary",
        hotspots: [],
        assessment: malformed,
        findings: [
          {
            severity: "medium",
            title: "Policy regression",
            path: "README.md",
            line: 1,
            side: "RIGHT",
            explanation:
              "The changed policy permits access in this concrete scenario.",
            suggestion: "Restore the guard.",
            evidence: [{ path: "README.md", line: 1, quote: fixture.source }],
            previousFindingId: null,
          },
        ],
        limitations: [],
      };
      const saved = await startAndRun();
      expect(saved.status).toBe("completed");
      expect(saved.result?.summary).toBe("Retained static summary");
      expect(saved.result?.findings[0].title).toBe("Policy regression");
      expect(saved.result?.assessment).toMatchObject({
        state: "incomplete",
        readiness: { state: "incomplete" },
      });
      expect("score" in saved.result!.assessment!).toBe(false);
    },
  );
  test("known absence of CI remains visible without fabricating missing observations", async () => {
    const github = await mocks.github();
    github.paginate = async () => [];
    mocks.github.mockResolvedValue(github);
    const saved = await startAndRun();
    expect(saved.result?.assessment).toMatchObject({
      state: "complete",
      readiness: { state: "ready_for_review" },
      signals: { checks: { state: "known", value: "none" } },
    });
    expect(saved.result?.assessment?.readiness.reasons).toContain(
      "No CI/checks were observed for the reviewed commit.",
    );
  });
  test("unavailable CI does not fail static review or invent readiness", async () => {
    const github = await mocks.github();
    github.paginate = async () => {
      throw new Error("Permission denied");
    };
    mocks.github.mockResolvedValue(github);
    const saved = await startAndRun();
    expect(saved).toMatchObject({
      status: "completed",
      result: {
        assessment: {
          state: "complete",
          score: 4,
          readiness: { state: "incomplete" },
          signals: { checks: { state: "unavailable", headSha: "head" } },
        },
      },
    });
  });
  test("provider groups persist shared hunks, withhold invented references, and keep feedback private and idempotent", async () => {
    const hunkId = "head:base:hunk:README.md:0";
    output = {
      summary: "Cross-file purpose",
      assessment: fixture.assessment,
      hotspots: [],
      findings: [],
      limitations: [],
      changeGroups: [
        {
          title: "Access policy",
          purpose: "Changes the authorization policy.",
          hunkIds: [hunkId],
        },
        {
          title: "Caller contract",
          purpose: "Changes the public access contract.",
          hunkIds: [hunkId],
        },
        {
          title: "Invented",
          purpose: "Unsupported group",
          hunkIds: ["different-snapshot"],
        },
      ],
    };
    const saved = await startAndRun();
    const files = await authenticated.query(api.reviews.files, {
      id: saved._id,
    });
    expect(files[0].hunks?.[0].id).toBe(hunkId);
    expect(saved.result?.changeGroups).toHaveLength(2);
    expect(saved.result?.changeGroups?.map((group) => group.hunkIds)).toEqual([
      [hunkId],
      [hunkId],
    ]);
    expect(
      saved.result?.coverage.warnings.some((warning) =>
        warning.includes("change group"),
      ),
    ).toBe(true);
    const feedback = {
      id: saved._id,
      groupId: saved.result!.changeGroups![0].id,
      requestId: "feedback-1",
      reason: "The caller contract is separate.",
    };
    const feedbackId = await authenticated.mutation(
      api.reviews.flagGrouping,
      feedback,
    );
    expect(
      await authenticated.mutation(api.reviews.flagGrouping, feedback),
    ).toBe(feedbackId);
    expect(
      await authenticated.query(api.reviews.groupingFeedback, {
        id: saved._id,
      }),
    ).toHaveLength(1);
    await expect(
      authenticated.mutation(api.reviews.flagGrouping, {
        ...feedback,
        reason: "Different content",
      }),
    ).rejects.toThrow("already used");
    await expect(
      authenticated.mutation(api.reviews.flagGrouping, {
        ...feedback,
        requestId: "feedback-2",
        groupId: "absent",
      }),
    ).rejects.toThrow("Change group not found");
    const bob = backend.withIdentity({ subject: "bob" });
    await expect(
      bob.query(api.reviews.groupingFeedback, { id: saved._id }),
    ).rejects.toThrow("Review not found");
    await expect(
      bob.mutation(api.reviews.flagGrouping, feedback),
    ).rejects.toThrow("Review not found");
  });
  test("two actual provider snapshots preserve old evidence and flag changed support even when the new interpretation is incomplete", async () => {
    const finding = {
      severity: "medium",
      title: "Authorization regression",
      path: "README.md",
      line: 1,
      side: "RIGHT",
      explanation: "The changed access policy permits this caller.",
      suggestion: "Restore the guard.",
      evidence: [{ path: "README.md", line: 1, quote: fixture.source }],
      previousFindingId: null,
    };
    output = {
      summary: "Original snapshot",
      assessment: fixture.assessment,
      findings: [finding],
      limitations: [],
      hotspots: [
        {
          kind: "human_judgment",
          title: "Access policy",
          reason: "Sensitive boundary",
          references: [{ path: "README.md", line: 1, side: "RIGHT" }],
        },
      ],
      changeGroups: [
        {
          title: "Access",
          purpose: "Authorization behavior",
          hunkIds: ["head:base:hunk:README.md:0"],
        },
      ],
    };
    const original = await startAndRun();
    const request = () =>
      new Request("http://localhost/api/reviews/freshness", {
        method: "POST",
        body: JSON.stringify({ reviewId: original._id }),
      });
    expect((await refreshFreshness(request())).status).toBe(200);
    expect(
      (await authenticated.query(api.reviews.get, { id: original._id }))
        .freshness?.state,
    ).toBe("current");
    const github = await mocks.github();
    const { data: live } = await github.rest.pulls.get();
    live.head.sha = "new-head";
    const source = "Authorization now requires a scoped policy token.";
    const patch = `@@ -1 +1 @@\n-old behavior\n+${source}`;
    github.rest.pulls.listFiles = async () => ({
      data: [
        { filename: "README.md", status: "modified", sha: "new-blob", patch },
      ],
    });
    github.rest.repos.compareCommitsWithBasehead = async () => ({
      data: {
        merge_base_commit: { sha: "merge-base" },
        files: [
          { filename: "README.md", status: "modified", sha: "new-blob", patch },
        ],
      },
    });
    github.rest.git.getTree = async ({ tree_sha }: { tree_sha: string }) => ({
      data: {
        truncated: false,
        tree: [
          {
            type: "blob",
            mode: "100644",
            path: "README.md",
            sha: tree_sha === "new-head" ? "new-blob" : "blob",
            size: source.length,
          },
        ],
      },
    });
    mocks.github.mockResolvedValue(github);
    expect((await refreshFreshness(request())).status).toBe(200);
    const refreshed = await authenticated.query(api.reviews.get, {
      id: original._id,
    });
    expect(refreshed).toMatchObject({
      headSha: "head",
      baseSha: "base",
      freshness: { state: "outdated", headSha: "new-head" },
    });
    expect(refreshed.result?.assessment).toMatchObject({
      state: "complete",
      score: 4,
    });
    output = {
      summary: "Updated code inspected",
      assessment: {
        state: "incomplete",
        missingEvidence: ["The new policy integration requires investigation."],
      },
      findings: [],
      limitations: [],
      hotspots: [
        {
          kind: "human_judgment",
          title: "Updated access policy",
          reason: "New policy needs judgment",
          references: [{ path: "README.md", line: 1, side: "RIGHT" }],
        },
      ],
      changeGroups: [
        {
          title: "Policy token",
          purpose: "Updated authorization contract",
          hunkIds: ["new-head:base:hunk:README.md:0"],
        },
      ],
    };
    const current = await startAndRun();
    expect(current).toMatchObject({
      status: "completed",
      previousReviewId: original._id,
      headSha: "new-head",
      result: {
        assessment: { state: "incomplete" },
        hotspots: [
          { references: [{ commitSha: "new-head", blobSha: "new-blob" }] },
        ],
        reassessment: {
          sourceReviewId: original._id,
          sourceHeadSha: "head",
          headSha: "new-head",
        },
      },
    });
    expect(
      current.result?.reassessment?.contexts.map((context) => [
        context.kind,
        context.state,
      ]),
    ).toEqual([
      ["finding", "changed"],
      ["hotspot", "changed"],
      ["group", "changed"],
    ]);
    expect(current.result?.reassessment?.absentFindingIds).toEqual([
      original.result!.findings[0].id,
    ]);
    expect("score" in current.result!.assessment!).toBe(false);
    const preserved = await authenticated.query(api.reviews.get, {
      id: original._id,
    });
    expect(preserved.result).toEqual(original.result);
    expect(preserved.result?.findings[0].evidence[0]).toMatchObject({
      commitSha: "head",
      blobSha: "blob",
    });
    const bob = backend.withIdentity({ subject: "bob" });
    await expect(
      bob.query(api.reviews.get, { id: current._id }),
    ).rejects.toThrow("Review not found");
    await expect(
      bob.query(api.reviews.get, { id: original._id }),
    ).rejects.toThrow("Review not found");
  });
  test("freshness failures remain explicit and another owner cannot refresh a saved review", async () => {
    const saved = await startAndRun();
    mocks.github.mockRejectedValue(new Error("provider failed"));
    const request = () =>
      new Request("http://localhost/api/reviews/freshness", {
        method: "POST",
        body: JSON.stringify({ reviewId: saved._id }),
      });
    expect((await refreshFreshness(request())).status).toBe(200);
    expect(
      await authenticated.query(api.reviews.get, { id: saved._id }),
    ).toMatchObject({ headSha: "head", freshness: { state: "unavailable" } });
    mocks.auth.mockResolvedValue({ userId: "bob", token: "bob-jwt" });
    mocks.publicQuery.mockImplementation((ref, args) =>
      backend.withIdentity({ subject: "bob" }).query(ref, args),
    );
    mocks.github.mockClear();
    expect((await refreshFreshness(request())).status).toBe(404);
    expect(mocks.github).not.toHaveBeenCalled();
  });
  test("older unpinned reviews expose unknown freshness without claiming that the PR changed", async () => {
    const started = await authenticated.mutation(api.reviews.start, {
      repoOwner: "alice",
      repoName: "app",
      pullNumber: 7,
      model: DEFAULT_CODING_MODEL_ID,
      instructions: "",
    });
    await backend.mutation(internal.reviewJobs.finish, {
      id: started.id,
      result: {
        summary: "Legacy",
        findings: [],
        outdated: false,
        coverage: {
          changedFiles: 0,
          diffFiles: [],
          filesRead: [],
          warnings: [],
        },
      },
    });
    const response = await refreshFreshness(
      new Request("http://localhost/api/reviews/freshness", {
        method: "POST",
        body: JSON.stringify({ reviewId: started.id }),
      }),
    );
    expect(response.status).toBe(200);
    expect(
      (await authenticated.query(api.reviews.get, { id: started.id }))
        .freshness,
    ).toMatchObject({ state: "unavailable" });
    expect(mocks.github).not.toHaveBeenCalled();
  });
  test("freshness requires authentication and validates the target before GitHub reads", async () => {
    const malformed = await refreshFreshness(
      new Request("http://localhost/api/reviews/freshness", {
        method: "POST",
        body: "{",
      }),
    );
    expect(malformed.status).toBe(400);
    expect(mocks.github).not.toHaveBeenCalled();
    mocks.auth.mockResolvedValue(null);
    expect(
      (
        await refreshFreshness(
          new Request("http://localhost/api/reviews/freshness", {
            method: "POST",
            body: JSON.stringify({ reviewId: "id" }),
          }),
        )
      ).status,
    ).toBe(401);
  });
  test("unauthenticated requests cannot admit a review", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await POST(
      new Request("http://localhost/api/reviews", {
        method: "POST",
        body: JSON.stringify({ url: "https://github.com/alice/app/pull/7" }),
      }),
    );
    expect(response.status).toBe(401);
    expect(await authenticated.query(api.reviews.list, {})).toEqual([]);
  });
});
