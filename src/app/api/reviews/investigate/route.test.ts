// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  github: vi.fn(),
  mutation: vi.fn(),
  send: vi.fn(),
  capability: vi.fn(),
  price: vi.fn(),
}));
vi.mock("@/lib/convex-auth", () => ({ getConvexAuth: mocks.auth }));
vi.mock("@/lib/github", () => ({ getGithubToken: mocks.github }));
vi.mock("@/lib/convex-client", () => ({
  getConvexAdminClient: () => ({ mutation: mocks.mutation }),
}));
vi.mock("@/inngest/client", () => ({ inngest: { send: mocks.send } }));
vi.mock("@/features/reviews/lib/execution-provider", () => ({
  executionCapability: mocks.capability,
}));
vi.mock("@/features/reviews/lib/finding-budget", () => ({
  quoteFindingModel: mocks.price,
}));
import { GET, POST } from "./route";
const input = {
  reviewId: "review",
  findingId: "finding",
  requestId: "request-123",
  maxDurationMs: 300_000,
  maxCostMicros: 2_000_000,
};
function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/reviews/investigate", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}
beforeEach(() => {
  mocks.auth.mockResolvedValue({ userId: "alice", token: "jwt" });
  mocks.github.mockResolvedValue("github-secret");
  mocks.capability.mockResolvedValue({
    available: true,
    reason: "Offline checks",
  });
  mocks.price.mockResolvedValue({
    inputMicrosPerToken: 2,
    outputMicrosPerToken: 8,
    quotedAt: 1,
  });
  mocks.mutation.mockResolvedValue({ workId: "work", dispatch: true });
  mocks.send.mockResolvedValue({ ids: ["event"] });
});
afterEach(() => vi.resetAllMocks());
test("investigation authenticates owner and server-verified price, never dispatches credentials", async () => {
  expect(
    (
      await post({
        ...input,
        ownerId: "attacker",
        price: { inputMicrosPerToken: 0 },
      })
    ).status,
  ).toBe(202);
  expect(mocks.mutation.mock.calls[0][1]).toEqual({
    ...input,
    ownerId: "alice",
    model: "openai/gpt-6-luna",
    price: { inputMicrosPerToken: 2, outputMicrosPerToken: 8, quotedAt: 1 },
  });
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
  mocks.auth.mockResolvedValue(null);
  expect((await GET()).status).toBe(401);
});
test("unavailable execution still starts a static investigation", async () => {
  mocks.capability.mockResolvedValue({
    available: false,
    reason: "Runner unavailable",
  });
  expect((await post(input)).status).toBe(202);
  expect(mocks.send).toHaveBeenCalledOnce();
  expect(await (await GET()).json()).toEqual({
    available: false,
    reason: "Runner unavailable",
  });
});
test("unknown pricing and invalid limits are explicit blocked states", async () => {
  expect((await post({ ...input, maxDurationMs: 1 })).status).toBe(400);
  mocks.price.mockRejectedValue(new Error("No verified price"));
  expect(await (await post(input)).json()).toEqual({
    error: "No verified price",
  });
});
