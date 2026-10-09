// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { getFunctionName } from "convex/server";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
  github: vi.fn(),
  chat: vi.fn(),
}));
vi.mock("@/lib/convex-client", () => ({ getConvexAdminClient: () => mocks }));
vi.mock("@/lib/github", () => ({ createUserOctokit: mocks.github }));
vi.mock("@/lib/openrouter", () => ({ openRouter: { chat: mocks.chat } }));
vi.mock("@/inngest/client", () => ({
  inngest: { createFunction: (_config: unknown, handler: unknown) => handler },
}));
import { reviewPullRequest } from "./review-pull-request";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        data: [
          { id: "small-model", context_length: 32_000 },
          { id: "large-model", context_length: 1_050_000 },
        ],
      }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

test.each(["small-model", "large-model"])(
  "the %s review carries early evidence into synthesis and saves a finding with independently stored anchors",
  async (model) => {
    const pr = {
      changed_files: 1,
      title: "Fix auth",
      body: "",
      base: { sha: "base" },
      head: { sha: "head", repo: { owner: { login: "owner" }, name: "app" } },
    };
    const loaded = {
      review: {
        status: "running",
        repoOwner: "owner",
        repoName: "app",
        pullNumber: 7,
        model,
        instructions: "",
      },
      previous: null,
    };
    mocks.query.mockImplementation((ref) =>
      getFunctionName(ref) === "reviewJobs:status" ? "running" : loaded,
    );
    mocks.mutation.mockResolvedValue(true);
    mocks.github.mockResolvedValue({
      rest: {
        pulls: {
          get: vi.fn().mockResolvedValue({ data: pr }),
          listFiles: vi.fn().mockResolvedValue({
            data: [
              {
                filename: "src/auth.ts",
                status: "modified",
                patch: `@@ -1 +1 @@\n-oldAuth();\n+${"newAuth();".padEnd(70_000, " ")}`,
              },
            ],
          }),
        },
        git: {
          getTree: vi.fn().mockResolvedValue({
            data: {
              tree: [
                {
                  type: "blob",
                  mode: "100644",
                  path: "src/caller.ts",
                  sha: "blob",
                  size: 30,
                },
              ],
              truncated: false,
            },
          }),
          getBlob: vi.fn().mockResolvedValue({
            data: {
              encoding: "base64",
              content: Buffer.from("return loadUser();").toString("base64"),
              size: 18,
            },
          }),
        },
      },
    });
    const requests: Array<{
      messages: Array<{ role: string; content?: string }>;
    }> = [];
    const provider = createOpenRouter({
      apiKey: "test-key",
      fetch: async (_url, options) => {
        requests.push(JSON.parse(String(options?.body)));
        const call = requests.length;
        const message =
          call === 1
            ? {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "anchors-1",
                    type: "function",
                    function: {
                      name: "getChangedLines",
                      arguments: JSON.stringify({
                        path: "src/auth.ts",
                        side: "RIGHT",
                        startLine: 1,
                      }),
                    },
                  },
                  {
                    id: "read-1",
                    type: "function",
                    function: {
                      name: "readFile",
                      arguments: JSON.stringify({
                        path: "src/caller.ts",
                        startLine: 1,
                        endLine: 1,
                      }),
                    },
                  },
                ],
              }
            : {
                role: "assistant",
                content:
                  call === 2
                    ? "Investigation finished"
                    : JSON.stringify({
                        hotspots: [],
                        assessment: {
                          state: "complete",
                          dimensions: {
                            impact: {
                              level: 4,
                              reason: "The authorization boundary changed.",
                            },
                            complexity: {
                              level: 2,
                              reason: "A related caller must be inspected.",
                            },
                            uncertainty: {
                              level: 3,
                              reason: "Runtime behavior remains unverified.",
                            },
                            coverage: {
                              level: 2,
                              reason:
                                "Only a subset of related source was inspected.",
                            },
                          },
                          evidence: [
                            {
                              path: "src/caller.ts",
                              line: 1,
                              quote: "return loadUser();",
                            },
                          ],
                        },
                        summary: "Found a bug",
                        findings: [
                          {
                            severity: "high",
                            title: "Missing authorization",
                            path: "src/auth.ts",
                            line: 1,
                            side: "RIGHT",
                            explanation: "Trigger",
                            suggestion: "Fix",
                            evidence: [
                              {
                                path: "src/caller.ts",
                                line: 1,
                                quote: "return loadUser();",
                              },
                            ],
                            previousFindingId: null,
                            category: null,
                            confidence: null,
                          },
                        ],
                        limitations: [],
                      }),
              };
        return Response.json({
          id: `completion-${call}`,
          created: 1,
          model: "test-model",
          choices: [
            {
              index: 0,
              message,
              finish_reason: call === 1 ? "tool_calls" : "stop",
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
        });
      },
    });
    mocks.chat.mockImplementation(() => provider.chat("test-model"));
    const handler = reviewPullRequest as unknown as (input: {
      event: { data: { reviewId: string; ownerId: string } };
      step: { run: (name: string, callback: () => unknown) => unknown };
    }) => Promise<unknown>;
    await handler({
      event: { data: { reviewId: "review-1", ownerId: "user-1" } },
      step: { run: (_name, callback) => callback() },
    });
    expect(requests).toHaveLength(3);
    const toolResults = requests[1].messages
      .filter((message) => message.role === "tool")
      .map((message) => JSON.parse(message.content!));
    expect(toolResults).toContainEqual(
      expect.objectContaining({
        path: "src/auth.ts",
        side: "RIGHT",
        lines: [1],
        partial: false,
      }),
    );
    expect(JSON.stringify(requests[2].messages)).toContain(
      "return loadUser();",
    );
    expect(JSON.stringify(requests[0].messages)).not.toContain('"anchors"');
    const saved = mocks.mutation.mock.calls.find(
      ([ref]) => getFunctionName(ref) === "reviewJobs:finish",
    )?.[1];
    expect(saved.result.findings).toHaveLength(1);
    expect(saved.result.assessment).toMatchObject({
      state: "complete",
      score: 4,
      headSha: "head",
      baseSha: "base",
      readiness: { state: "needs_attention" },
    });
    expect(saved.result.coverage.filesRead).toContain("src/caller.ts");
    expect(saved.result.coverage.diffFiles).toEqual(
      model === "small-model" ? [] : ["src/auth.ts"],
    );
    const savedFiles = mocks.mutation.mock.calls.find(
      ([ref]) => getFunctionName(ref) === "reviewJobs:saveFiles",
    )?.[1];
    expect(savedFiles.files).toEqual([
      expect.objectContaining({
        filename: "src/auth.ts",
        patch: expect.stringContaining("+newAuth();"),
        omittedReason:
          model === "small-model" ? "diff token budget" : undefined,
      }),
    ]);
  },
);

test("a diff beyond one model context is reviewed in parts and merged from their evidence", async () => {
  const pad = (line: string) => line.padEnd(70_000, " ");
  mocks.query.mockImplementation((ref) =>
    getFunctionName(ref) === "reviewJobs:status"
      ? "running"
      : {
          review: {
            status: "running",
            repoOwner: "owner",
            repoName: "app",
            pullNumber: 7,
            model: "large-model",
            instructions: "",
          },
          previous: null,
        },
  );
  mocks.mutation.mockResolvedValue(true);
  mocks.github.mockResolvedValue({
    rest: {
      pulls: {
        get: vi.fn().mockResolvedValue({
          data: {
            changed_files: 2,
            title: "Fix auth and billing",
            body: "",
            base: { sha: "base" },
            head: {
              sha: "head",
              repo: { owner: { login: "owner" }, name: "app" },
            },
          },
        }),
        listFiles: vi.fn().mockResolvedValue({
          data: [
            {
              filename: "src/auth.ts",
              sha: "auth-blob",
              status: "modified",
              patch: `@@ -1 +1 @@\n-oldAuth();\n+${pad("newAuth();")}`,
            },
            {
              filename: "src/billing.ts",
              sha: "billing-blob",
              status: "modified",
              patch: `@@ -1 +1 @@\n-oldCharge();\n+${pad("chargeCard();")}`,
            },
          ],
        }),
      },
      git: {
        getTree: vi
          .fn()
          .mockResolvedValue({ data: { tree: [], truncated: false } }),
      },
    },
  });
  const finding = (path: string, quote: string) => ({
    severity: "high",
    title: `Broken ${path}`,
    path,
    line: 1,
    side: "RIGHT",
    explanation: "Trigger",
    suggestion: "Fix",
    evidence: [{ path, line: 1, quote }],
    previousFindingId: null,
    category: null,
    confidence: null,
  });
  const review = (findings: unknown[]) => ({
    assessment: null,
    hotspots: [],
    changeGroups: [],
    summary: "Reviewed",
    findings,
    limitations: [],
  });
  const requests: string[] = [];
  const provider = createOpenRouter({
    apiKey: "test-key",
    fetch: async (_url, options) => {
      const body = String(options?.body);
      requests.push(body);
      const final = !JSON.parse(body).tools;
      const content = !final
        ? "Investigation finished"
        : JSON.stringify(
            body.includes("partReports")
              ? review([
                  finding("src/auth.ts", "newAuth();"),
                  finding("src/billing.ts", "chargeCard();"),
                  finding("src/billing.ts", "never inspected();"),
                ])
              : body.includes("+newAuth();")
                ? review([finding("src/auth.ts", "newAuth();")])
                : review([finding("src/billing.ts", "chargeCard();")]),
          );
      return Response.json({
        id: `completion-${requests.length}`,
        created: 1,
        model: "test-model",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      });
    },
  });
  mocks.chat.mockImplementation(() => provider.chat("test-model"));
  const steps: string[] = [];
  const handler = reviewPullRequest as unknown as (input: {
    event: { data: { reviewId: string; ownerId: string } };
    step: { run: (name: string, callback: () => unknown) => unknown };
  }) => Promise<unknown>;
  await handler({
    event: { data: { reviewId: "review-1", ownerId: "user-1" } },
    step: {
      run: (name, callback) => {
        steps.push(name);
        return callback();
      },
    },
  });
  expect(steps).toEqual([
    "load-review",
    "load-model-budget",
    "load-pinned-pr",
    "investigate-part-1",
    "investigate-part-2",
    "synthesize-review",
    "save-review",
  ]);
  // Each part sees only its own patch; synthesis sees reports, not patches.
  const parts = requests.filter((body) => body.includes("reviewScope"));
  expect(parts.filter((body) => body.includes("+newAuth();"))).toHaveLength(2);
  expect(
    parts.every(
      (body) =>
        !body.includes("+newAuth();") || !body.includes("+chargeCard();"),
    ),
  ).toBe(true);
  const synthesis = requests.find((body) => body.includes("partReports"))!;
  expect(synthesis).not.toContain("+newAuth();");
  expect(synthesis).not.toContain("+chargeCard();");
  // Only synthesis announces finding preparation in a split review.
  const progress = mocks.mutation.mock.calls
    .filter(([ref]) => getFunctionName(ref) === "reviewJobs:progress")
    .map(([, args]) => args.progress);
  expect(progress.filter((text: string) => text.includes("preparing"))).toEqual(
    ["Checking evidence and preparing findings"],
  );
  expect(progress.at(-1)).toBe("Checking evidence and preparing findings");
  const saved = mocks.mutation.mock.calls.find(
    ([ref]) => getFunctionName(ref) === "reviewJobs:finish",
  )?.[1];
  expect(saved.result.findings.map((f: { path: string }) => f.path)).toEqual([
    "src/auth.ts",
    "src/billing.ts",
  ]);
  expect(saved.result.coverage.diffFiles).toEqual([
    "src/auth.ts",
    "src/billing.ts",
  ]);
  expect(saved.result.coverage.warnings).toContainEqual(
    expect.stringContaining("1 proposed finding(s) were withheld"),
  );
});
