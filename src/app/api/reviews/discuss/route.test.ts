import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ConvexError } from "convex/values";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  github: vi.fn(),
  mutation: vi.fn(),
  send: vi.fn(),
}));
vi.mock("@/lib/convex-auth", () => ({ getConvexAuth: mocks.auth }));
vi.mock("@/lib/github", () => ({ getGithubToken: mocks.github }));
vi.mock("convex/nextjs", () => ({ fetchMutation: mocks.mutation }));
vi.mock("@/inngest/client", () => ({ inngest: { send: mocks.send } }));
import { POST } from "./route";
function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/reviews/discuss", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}
beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "model-secret");
  vi.stubEnv("CONVEX_DEPLOY_KEY", "admin-secret");
  mocks.auth.mockResolvedValue({ userId: "alice", token: "jwt" });
  mocks.github.mockResolvedValue("github-secret");
  mocks.mutation.mockResolvedValue({
    workId: "work",
    created: true,
    dispatch: true,
  });
  mocks.send.mockResolvedValue({ ids: ["event"] });
});
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});
test("authenticated discussion dispatch contains only server-derived owner and work identity", async () => {
  const response = await post({
    reviewId: "review",
    findingId: "finding",
    requestId: "request-123",
    body: "Check caller",
    ownerId: "attacker",
  });
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ workId: "work" });
  expect(mocks.send.mock.calls[0][0]).toEqual({
    id: "finding-work",
    name: "review/finding.requested",
    data: {
      workId: "work",
      ownerId: "alice",
      generation: 0,
      dispatchId: "finding-work",
    },
  });
  expect(JSON.stringify(mocks.send.mock.calls)).not.toContain("secret");
  mocks.auth.mockResolvedValue(null);
  expect((await post({})).status).toBe(401);
});
test("invalid, disconnected and unauthorized requests give actionable errors", async () => {
  expect((await post({ body: "" })).status).toBe(400);
  mocks.github.mockResolvedValue(null);
  expect(
    (
      await post({
        reviewId: "review",
        findingId: "finding",
        requestId: "request-123",
        body: "Check",
      })
    ).status,
  ).toBe(409);
  mocks.github.mockResolvedValue("secret");
  mocks.mutation.mockRejectedValue(new ConvexError("Finding not found"));
  const response = await post({
    reviewId: "other-review",
    findingId: "finding",
    requestId: "request-123",
    body: "Check",
  });
  expect(await response.json()).toEqual({ error: "Finding not found" });
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.mutation.mockRejectedValue(
    new Error("[Request ID: 1] Server Error: deployment details"),
  );
  const failed = await post({
    reviewId: "review",
    findingId: "finding",
    requestId: "request-123",
    body: "Check",
  });
  expect(failed.status).toBe(503);
  expect(await failed.json()).toEqual({
    error: "Could not queue a response. Retry the same message.",
  });
});
