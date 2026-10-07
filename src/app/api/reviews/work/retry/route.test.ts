// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import schema from "../../../../../../convex/schema";
import { api, internal } from "../../../../../../convex/_generated/api";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  mutation: vi.fn(),
  send: vi.fn(),
}));
vi.mock("@/lib/convex-auth", () => ({ getConvexAuth: mocks.auth }));
vi.mock("convex/nextjs", () => ({ fetchMutation: mocks.mutation }));
vi.mock("@/inngest/client", () => ({ inngest: { send: mocks.send } }));
import { POST } from "./route";
const modules = import.meta.glob("../../../../../../convex/**/*.ts");
test("owner can recover failed dispatch and cancelled/failed work without duplicating the saved message", async () => {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({ subject: "alice" });
  const workId = await t.run(async (ctx) => {
    const reviewId = await ctx.db.insert("reviews", {
      ownerId: "alice",
      url: "url",
      repoOwner: "upstream",
      repoName: "app",
      pullNumber: 1,
      model: "openai/gpt-6-luna",
      instructions: "",
      status: "completed",
      progress: "Complete",
      updatedAt: 0,
    });
    const workId = await ctx.db.insert("reviewFindingWork", {
      ownerId: "alice",
      reviewId,
      findingId: "finding",
      requestId: "request-123",
      kind: "discussion",
      model: "openai/gpt-6-luna",
      status: "queued",
      attempt: 0,
      body: "Saved challenge",
      headSha: "head",
      baseSha: "base",
      sourceOwner: "fork",
      sourceRepo: "app",
      maxDurationMs: 300000,
      maxCostMicros: 2000000,
      reservedCostMicros: 123,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      progress: "Waiting",
    });
    await ctx.db.insert("reviewMessages", {
      reviewId,
      findingId: "finding",
      workId,
      role: "user",
      body: "Saved challenge",
      createdAt: Date.now(),
    });
    return workId;
  });
  mocks.auth.mockResolvedValue({ userId: "alice", token: "jwt" });
  mocks.mutation.mockImplementation((reference, args) =>
    owner.mutation(reference, args),
  );
  mocks.send
    .mockRejectedValueOnce(new Error("dispatch failed"))
    .mockResolvedValue({ ids: ["event"] });
  const retry = () =>
    POST(
      new Request("http://localhost/api/reviews/work/retry", {
        method: "POST",
        body: JSON.stringify({ workId }),
      }),
    );
  expect((await retry()).status).toBe(409);
  expect((await retry()).status).toBe(202);
  expect(mocks.send.mock.calls[0][0].id).toBe(mocks.send.mock.calls[1][0].id);
  const first = await t.mutation(internal.reviewFindingJobs.claim, {
    workId,
    ownerId: "alice",
  });
  expect(
    await t.mutation(internal.reviewFindingJobs.claim, {
      workId,
      ownerId: "alice",
    }),
  ).toBeNull();
  await owner.mutation(api.reviewInteractions.cancel, { workId });
  expect((await retry()).status).toBe(202);
  expect(
    await t.mutation(internal.reviewFindingJobs.claim, {
      workId,
      ownerId: "alice",
      generation: 0,
    }),
  ).toBeNull();
  const second = await t.mutation(internal.reviewFindingJobs.claim, {
    generation: 1,
    workId,
    ownerId: "alice",
  });
  expect(second).toBeGreaterThan(first!);
  await t.mutation(internal.reviewFindingJobs.fail, {
    workId,
    generation: 0,
    error: "old failure",
  });
  expect(
    (await t.run((ctx) => ctx.db.get("reviewFindingWork", workId)))?.status,
  ).toBe("running");
  await t.mutation(internal.reviewFindingJobs.fail, {
    generation: 1,
    workId,
    attempt: second!,
    error: "model unavailable",
  });
  expect((await retry()).status).toBe(202);
  const saved = await t.run(async (ctx) => ({
    messages: await ctx.db.query("reviewMessages").collect(),
    work: await ctx.db.get("reviewFindingWork", workId),
  }));
  expect(saved.messages).toHaveLength(1);
  expect(saved.work?.reservedCostMicros).toBe(123);
  mocks.mutation.mockImplementation((reference, args) =>
    t.withIdentity({ subject: "bob" }).mutation(reference, args),
  );
  expect((await retry()).status).toBe(409);
});
