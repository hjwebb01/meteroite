// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  mutation: vi.fn(),
  send: vi.fn(),
  stop: vi.fn(),
}));
vi.mock("@/lib/convex-auth", () => ({ getConvexAuth: mocks.auth }));
vi.mock("convex/nextjs", () => ({ fetchMutation: mocks.mutation }));
vi.mock("@/inngest/client", () => ({ inngest: { send: mocks.send } }));
vi.mock("@/features/reviews/lib/execution-provider", () => ({
  stopIsolatedExecution: mocks.stop,
}));
import { POST } from "./route";
function cancel() {
  return POST(
    new Request("http://localhost/api/reviews/work/cancel", {
      method: "POST",
      body: JSON.stringify({ workId: "work" }),
    }),
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ userId: "owner", token: "jwt" });
  mocks.mutation.mockResolvedValue({ executionUnit: "unit" });
  mocks.send.mockRejectedValue(new Error("delivery unavailable"));
});
test("cancellation persists and eagerly stops the sandbox even when event delivery fails", async () => {
  mocks.stop.mockImplementation(async () => {
    expect(mocks.mutation).toHaveBeenCalled();
    return true;
  });
  expect(await (await cancel()).json()).toEqual({
    success: true,
    executionStopped: true,
  });
  expect(mocks.stop).toHaveBeenCalledWith("unit");
});
test("failed eager stop is reported without claiming repository execution stopped", async () => {
  mocks.stop.mockResolvedValue(false);
  expect(await (await cancel()).json()).toEqual({
    success: true,
    executionStopped: false,
  });
  mocks.auth.mockResolvedValue(null);
  expect((await cancel()).status).toBe(401);
});
