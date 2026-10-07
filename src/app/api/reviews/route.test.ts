import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  github: vi.fn(),
  mutation: vi.fn(),
  query: vi.fn(),
  send: vi.fn(),
}));
vi.mock("@/lib/convex-auth", () => ({ getConvexAuth: mocks.auth }));
vi.mock("@/lib/github", () => ({ getGithubToken: mocks.github }));
vi.mock("convex/nextjs", () => ({
  fetchMutation: mocks.mutation,
  fetchQuery: mocks.query,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/inngest/client", () => ({ inngest: { send: mocks.send } }));
import { GET, POST } from "./route";
import { api } from "../../../../convex/_generated/api";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("private review API", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");
    vi.stubEnv("CONVEX_DEPLOY_KEY", "dev:example|test-deploy-key");
    vi.stubEnv("INNGEST_EVENT_KEY", "test-event-key");
    mocks.auth.mockResolvedValue({ userId: "alice", token: "user-jwt" });
    mocks.github.mockResolvedValue("github-secret");
    mocks.mutation.mockResolvedValue({ id: "review-id", created: true });
    mocks.query.mockResolvedValue([]);
    mocks.send.mockResolvedValue({ ids: ["event-id"] });
  });
  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
  });

  test("unauthenticated callers cannot read configuration or start jobs", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(
      (await post({ url: "https://github.com/alice/app/pull/1" })).status,
    ).toBe(401);
    expect(mocks.github).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  test("rejects non-GitHub URLs, malformed JSON, and unsupported models before creating a job", async () => {
    expect(
      (await post({ url: "https://evil.test/alice/app/pull/1" })).status,
    ).toBe(400);
    expect(
      (
        await post({
          url: "https://github.com/alice/app/pull/1",
          model: "unknown/model",
        })
      ).status,
    ).toBe(400);
    const malformed = await POST(
      new Request("http://localhost/api/reviews", {
        method: "POST",
        body: "{",
      }),
    );
    expect(malformed.status).toBe(400);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
  test("uses the signed-in owner and canonical PR identifiers without persisting the GitHub token", async () => {
    const response = await post({
      url: "https://github.com/Alice/App/pull/7/files",
      instructions: "  Check auth  ",
    });
    expect(response.status).toBe(202);
    expect(mocks.mutation).toHaveBeenCalledWith(
      api.reviews.start,
      expect.objectContaining({
        repoOwner: "alice",
        repoName: "app",
        pullNumber: 7,
        instructions: "Check auth",
      }),
      { token: "user-jwt" },
    );
    expect(mocks.send).toHaveBeenCalledWith({
      name: "review/requested",
      data: { reviewId: "review-id", ownerId: "alice" },
    });
    expect(JSON.stringify(mocks.send.mock.calls)).not.toContain(
      "github-secret",
    );
  });
  test("does not enqueue a duplicate active run", async () => {
    mocks.mutation.mockResolvedValue({ id: "existing", created: false });
    expect(
      (await post({ url: "https://github.com/alice/app/pull/1" })).status,
    ).toBe(202);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  test("marks a queue failure instead of leaving a permanently queued review", async () => {
    mocks.send.mockRejectedValue(new Error("Unavailable"));
    expect(
      (await post({ url: "https://github.com/alice/app/pull/1" })).status,
    ).toBe(503);
    expect(mocks.mutation).toHaveBeenLastCalledWith(
      api.reviews.failToQueue,
      { id: "review-id" },
      { token: "user-jwt" },
    );
  });
  test("requires a connected GitHub account", async () => {
    mocks.github.mockResolvedValue(null);
    expect(
      (await post({ url: "https://github.com/alice/app/pull/1" })).status,
    ).toBe(409);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  test("keeps saved reviews available even when model configuration is missing", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const status = await (await GET()).json();
    expect(status).toMatchObject({
      ready: false,
      historyAvailable: true,
      missing: ["OPENROUTER_API_KEY"],
    });
    expect(
      (await post({ url: "https://github.com/alice/app/pull/1" })).status,
    ).toBe(503);
  });
  test("reports a deploy key that cannot authenticate the worker", async () => {
    vi.stubEnv("CONVEX_DEPLOY_KEY", "preview:team:project|secret");
    const status = await (await GET()).json();
    expect(status).toMatchObject({ ready: false, historyAvailable: true });
    expect(status.reason).toContain("not a deploy key for example");
    expect(
      (await post({ url: "https://github.com/alice/app/pull/1" })).status,
    ).toBe(503);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  test("does not enable subscriptions when the new backend is unavailable", async () => {
    mocks.query.mockRejectedValue(new Error("Function not deployed"));
    expect(await (await GET()).json()).toMatchObject({
      ready: false,
      historyAvailable: false,
    });
  });
});
