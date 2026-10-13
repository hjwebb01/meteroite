import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { RequestError } from "octokit";
import { getFunctionName } from "convex/server";
import { internal } from "../../../../../convex/_generated/api";
import {
  buildGithubReview,
  reviewMarker,
} from "@/features/reviews/lib/github-review";
import type { Doc } from "../../../../../convex/_generated/dataModel";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  octokit: vi.fn(),
  query: vi.fn(),
  record: vi.fn(),
  listReviews: vi.fn(),
  createReview: vi.fn(),
  getPull: vi.fn(),
}));
vi.mock("@/lib/convex-auth", () => ({ getConvexAuth: mocks.auth }));
vi.mock("@/lib/github", () => ({ createUserOctokit: mocks.octokit }));
vi.mock("convex/nextjs", () => ({ fetchQuery: mocks.query }));
vi.mock("@/lib/convex-client", () => ({
  getConvexAdminClient: () => ({ mutation: mocks.record }),
}));
import { GET, POST } from "./route";

const finding = {
  id: "review:0",
  severity: "high",
  title: "Discount applied twice",
  path: "cart.ts",
  line: 12,
  side: "RIGHT",
  explanation: "The code is re-applied on refresh.",
  suggestion: "Store applied codes on the cart.",
  evidence: [{ path: "cart.ts", line: 12, quote: "applyDiscount(code)" }],
  previousFindingId: null,
};
const retracted = { ...finding, id: "review:1", title: "Retracted claim" };
const review = {
  _id: "review",
  ownerId: "alice",
  repoOwner: "acme",
  repoName: "shop",
  pullNumber: 7,
  status: "completed",
  headSha: "abcdef1234",
  baseTipSha: "base1234",
  result: { summary: "Adds discount codes.", findings: [finding, retracted] },
};
function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/reviews/publish", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}
async function preview() {
  const response = await GET(
    new Request("http://localhost/api/reviews/publish?reviewId=review"),
  );
  expect(response.status).toBe(200);
  return (await response.json()).preview;
}
function savedReview(
  saved: typeof review | object,
  verdicts: Record<string, string> = { "review:1": "incorrect" },
) {
  mocks.query.mockImplementation(async () => {
    const excludedFindingIds = Object.entries(verdicts)
      .filter(([, verdict]) => verdict === "incorrect")
      .map(([id]) => id);
    return {
      review: saved,
      excludedFindingIds,
      source: JSON.stringify({ saved, verdicts }),
    };
  });
}
function mutationResult(fn: Parameters<typeof getFunctionName>[0]) {
  if (
    getFunctionName(fn) === getFunctionName(internal.reviewPublications.claim)
  )
    return { state: "claimed" };
  if (
    getFunctionName(fn) ===
    getFunctionName(internal.reviewPublications.authorizeWrite)
  )
    return true;
  if (
    getFunctionName(fn) === getFunctionName(internal.reviewPublications.reset)
  )
    return true;
  return null;
}
beforeEach(() => {
  mocks.auth.mockResolvedValue({ userId: "alice", token: "jwt" });
  mocks.octokit.mockResolvedValue({
    paginate: {
      iterator: async function* (method: () => Promise<unknown>) {
        yield { data: await method() };
      },
    },
    rest: {
      pulls: {
        listReviews: mocks.listReviews,
        createReview: mocks.createReview,
        get: mocks.getPull,
      },
    },
  });
  mocks.getPull.mockResolvedValue({
    data: { head: { sha: review.headSha }, base: { sha: review.baseTipSha } },
  });
  mocks.listReviews.mockResolvedValue([]);
  mocks.createReview.mockResolvedValue({
    data: { id: 9, html_url: "https://github.com/acme/shop/pull/7#r9" },
  });
  mocks.record.mockImplementation(async (fn) => mutationResult(fn));
  savedReview(review);
});
afterEach(() => vi.resetAllMocks());

function abandonedReview() {
  return {
    ...review,
    githubPublication: {
      attemptId: "abandoned",
      source: "old",
      state: "uncertain",
      startedAt: Date.now() - 16 * 60_000,
      remoteStartedAt: Date.now() - 16 * 60_000,
    },
  };
}

test("resetting an uncertain attempt checks GitHub, sends nothing, and requires a new preview", async () => {
  savedReview(abandonedReview());
  const output = await preview();
  expect(output.resetAttemptId).toBe("abandoned");
  expect(output.confirmation).toBeNull();
  const response = await post({
    reviewId: "review",
    action: "reset_uncertain",
    attemptId: output.resetAttemptId,
  });
  expect(await response.json()).toEqual({ reset: true });
  expect(mocks.record).toHaveBeenCalledWith(internal.reviewPublications.reset, {
    id: "review",
    ownerId: "alice",
    attemptId: "abandoned",
  });
  expect(mocks.createReview).not.toHaveBeenCalled();
});

test("failed GitHub reconciliation cannot offer or reset an uncertain attempt", async () => {
  savedReview(abandonedReview());
  mocks.listReviews.mockRejectedValue(new Error("GitHub unavailable"));
  expect((await preview()).resetAttemptId).toBeNull();
  const response = await post({
    reviewId: "review",
    action: "reset_uncertain",
    attemptId: "abandoned",
  });
  expect(response.status).toBe(502);
  expect(mocks.record).not.toHaveBeenCalled();
  expect(mocks.createReview).not.toHaveBeenCalled();
});

test("reconciliation recovers a discovered post instead of resetting or posting again", async () => {
  savedReview(abandonedReview());
  mocks.listReviews.mockResolvedValue([
    {
      id: 9,
      html_url: "https://github.com/acme/shop/pull/7#pullrequestreview-9",
      body: reviewMarker("review"),
      commit_id: review.headSha,
    },
  ]);
  const response = await post({
    reviewId: "review",
    action: "reset_uncertain",
    attemptId: "abandoned",
  });
  expect((await response.json()).githubReview.id).toBe(9);
  expect(
    mocks.record.mock.calls.some(
      ([fn]) =>
        getFunctionName(fn) ===
        getFunctionName(internal.reviewPublications.reset),
    ),
  ).toBe(false);
  expect(mocks.createReview).not.toHaveBeenCalled();
});

test("one publish request scans GitHub reviews once and reports a concurrent claim as pending", async () => {
  const output = await preview();
  mocks.listReviews.mockClear();
  mocks.record.mockImplementation(async (fn) =>
    getFunctionName(fn) === getFunctionName(internal.reviewPublications.claim)
      ? { state: "busy" }
      : mutationResult(fn),
  );
  const response = await post({
    reviewId: "review",
    confirmation: output.confirmation,
  });
  expect((await response.json()).code).toBe("publication_pending");
  expect(mocks.listReviews).toHaveBeenCalledOnce();
  expect(mocks.createReview).not.toHaveBeenCalled();
});

test("an authorization deadline that expires before transport does not leave an uncertain claim", async () => {
  const output = await preview();
  const timeout = vi
    .spyOn(AbortSignal, "timeout")
    .mockReturnValue(
      AbortSignal.abort(new Error("Authorization deadline expired")),
    );
  try {
    const response = await post({
      reviewId: "review",
      confirmation: output.confirmation,
    });
    expect(response.status).toBe(502);
    expect(mocks.createReview).not.toHaveBeenCalled();
    expect(mocks.record).toHaveBeenCalledWith(
      internal.reviewPublications.fail,
      expect.objectContaining({ uncertain: false }),
    );
  } finally {
    timeout.mockRestore();
  }
});

test("GET previews both exact serializer representations, actual exclusions, target and a content-bound confirmation", async () => {
  const output = await preview();
  const saved = review as unknown as Doc<"reviews">;
  expect(output.normal).toEqual(
    buildGithubReview(saved, [saved.result!.findings[0]]),
  );
  expect(output.fallback).toEqual(
    buildGithubReview(saved, [saved.result!.findings[0]], { inline: false }),
  );
  expect(output.excludedFindings).toEqual([
    { id: retracted.id, title: retracted.title },
  ]);
  expect(output.target).toMatchObject({
    headSha: review.headSha,
    baseTipSha: review.baseTipSha,
    event: "COMMENT",
  });
  expect(output.confirmation).toMatch(/^[a-f0-9]{64}$/);
  expect(mocks.createReview).not.toHaveBeenCalled();
});

test("only a genuine unchanged preview can publish exact COMMENT output for the signed-in owner", async () => {
  const output = await preview();
  const response = await post({
    reviewId: "review",
    confirmation: output.confirmation,
    ownerId: "mallory",
  });
  expect(response.status).toBe(200);
  expect((await response.json()).githubReview).toMatchObject({
    id: 9,
    headSha: review.headSha,
  });
  for (const [, , options] of mocks.query.mock.calls)
    expect(options).toEqual({ token: "jwt" });
  expect(mocks.octokit).toHaveBeenCalledWith("alice");
  expect(mocks.createReview).toHaveBeenCalledExactlyOnceWith({
    owner: "acme",
    repo: "shop",
    pull_number: 7,
    commit_id: review.headSha,
    event: "COMMENT",
    ...output.normal,
    request: { signal: expect.any(AbortSignal), retries: 0 },
  });
  expect(
    mocks.record.mock.calls.some(
      ([, args]) => args.ownerId === "alice" && args.githubReview?.id === 9,
    ),
  ).toBe(true);
});

test("missing confirmation, unauthenticated and other-owner requests never publish", async () => {
  mocks.auth.mockResolvedValueOnce(null);
  expect((await post({ reviewId: "review" })).status).toBe(401);
  expect((await post({ reviewId: "review" })).status).toBe(400);
  mocks.query.mockRejectedValue(new Error("Review not found"));
  expect(
    (await post({ reviewId: "bob", confirmation: "a".repeat(64) })).status,
  ).toBe(404);
  expect(mocks.createReview).not.toHaveBeenCalled();
});

test.each(["summary", "finding", "exclusion", "verdict", "target"])(
  "changing %s invalidates the preview before remote writes",
  async (change) => {
    const output = await preview();
    if (change === "summary")
      savedReview({
        ...review,
        result: { ...review.result, summary: "New summary" },
      });
    if (change === "finding")
      savedReview({
        ...review,
        result: {
          ...review.result,
          findings: [
            { ...finding, explanation: "Different evidence" },
            retracted,
          ],
        },
      });
    if (change === "exclusion") savedReview(review, {});
    if (change === "verdict")
      savedReview(review, { "review:1": "incorrect", "review:0": "supported" });
    if (change === "target") savedReview({ ...review, pullNumber: 8 });
    const response = await post({
      reviewId: "review",
      confirmation: output.confirmation,
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/Refresh the preview/);
    expect(mocks.createReview).not.toHaveBeenCalled();
  },
);

test.each(["head", "base", "unknown"])(
  "changed or %s live freshness blocks publication",
  async (change) => {
    const output = await preview();
    if (change === "unknown")
      mocks.getPull.mockRejectedValue(new Error("GitHub unavailable"));
    else
      mocks.getPull.mockResolvedValue({
        data: {
          head: { sha: change === "head" ? "new-head" : review.headSha },
          base: { sha: change === "base" ? "new-base" : review.baseTipSha },
        },
      });
    const response = await post({
      reviewId: "review",
      confirmation: output.confirmation,
    });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("freshness_blocked");
    expect(mocks.createReview).not.toHaveBeenCalled();
  },
);

test("unknown freshness cannot yield a usable preview confirmation", async () => {
  mocks.getPull.mockRejectedValue(new Error("Unavailable"));
  const output = await preview();
  expect(output.freshness.state).toBe("unavailable");
  expect(output.confirmation).toBeNull();
});

test.each(["claim", "authorize"])(
  "atomic %s detects content changes or concurrent publication",
  async (phase) => {
    const output = await preview();
    mocks.record.mockImplementation(async (fn) => {
      const name = getFunctionName(fn);
      if (
        phase === "claim" &&
        name === getFunctionName(internal.reviewPublications.claim)
      )
        return { state: "changed" };
      if (
        phase === "authorize" &&
        name === getFunctionName(internal.reviewPublications.authorizeWrite)
      )
        return false;
      return mutationResult(fn);
    });
    expect(
      (await post({ reviewId: "review", confirmation: output.confirmation }))
        .status,
    ).toBe(409);
    expect(mocks.createReview).not.toHaveBeenCalled();
  },
);

test("a live revision moving between reservation and write is checked again", async () => {
  const output = await preview();
  mocks.getPull.mockResolvedValueOnce({
    data: { head: { sha: review.headSha }, base: { sha: review.baseTipSha } },
  });
  mocks.getPull.mockResolvedValue({
    data: { head: { sha: "later" }, base: { sha: review.baseTipSha } },
  });
  expect(
    (await post({ reviewId: "review", confirmation: output.confirmation }))
      .status,
  ).toBe(409);
  expect(mocks.createReview).not.toHaveBeenCalled();
});

test("fallback posts the exact preview and reauthorizes content and freshness", async () => {
  const output = await preview();
  mocks.createReview.mockRejectedValueOnce(
    new RequestError("Line unavailable", 422, {
      request: { method: "POST", url: "", headers: {} },
    }),
  );
  expect(
    (await post({ reviewId: "review", confirmation: output.confirmation }))
      .status,
  ).toBe(200);
  expect(mocks.createReview.mock.calls[1][0]).toMatchObject(output.fallback);
  const checks = mocks.record.mock.calls.filter(
    ([fn]) =>
      getFunctionName(fn) ===
      getFunctionName(internal.reviewPublications.authorizeWrite),
  );
  expect(checks).toHaveLength(2);
});

test("content changing after inline rejection blocks the fallback rather than sending unseen output", async () => {
  const output = await preview();
  mocks.createReview.mockRejectedValueOnce(
    new RequestError("Line unavailable", 422, {
      request: { method: "POST", url: "", headers: {} },
    }),
  );
  let checks = 0;
  mocks.record.mockImplementation(async (fn) => {
    if (
      getFunctionName(fn) ===
      getFunctionName(internal.reviewPublications.authorizeWrite)
    )
      return ++checks === 1;
    return mutationResult(fn);
  });
  expect(
    (await post({ reviewId: "review", confirmation: output.confirmation }))
      .status,
  ).toBe(409);
  expect(mocks.createReview).toHaveBeenCalledTimes(1);
});

test("recorded and unrecorded GitHub posts recover even after the live PR moves", async () => {
  const output = await preview();
  mocks.getPull.mockRejectedValue(new Error("Moved or unavailable"));
  mocks.listReviews.mockResolvedValue([
    {
      id: 3,
      html_url: "https://github.com/r/3",
      body: reviewMarker("review"),
      commit_id: review.headSha,
    },
  ]);
  const recovered = await post({
    reviewId: "review",
    confirmation: output.confirmation,
  });
  expect((await recovered.json()).githubReview.id).toBe(3);
  expect(mocks.createReview).not.toHaveBeenCalled();
  const githubReview = {
    id: 4,
    url: "https://github.com/r/4",
    headSha: review.headSha,
    postedAt: 1,
  };
  savedReview({ ...review, githubReview });
  expect(
    await (
      await post({ reviewId: "review", confirmation: output.confirmation })
    ).json(),
  ).toEqual({ githubReview });
});

test("uncertain remote writes remain recoverable and are not blindly retried", async () => {
  const output = await preview();
  mocks.createReview.mockRejectedValue(
    new Error("Connection reset after request"),
  );
  const response = await post({
    reviewId: "review",
    confirmation: output.confirmation,
  });
  expect(response.status).toBe(502);
  expect((await response.json()).code).toBe("publication_uncertain");
  expect(
    mocks.record.mock.calls.some(([, args]) => args.uncertain === true),
  ).toBe(true);
  savedReview({
    ...review,
    githubPublication: {
      attemptId: "prior",
      source: "source",
      state: "uncertain",
      startedAt: 1,
      remoteStartedAt: 2,
    },
  });
  const repeated = await post({
    reviewId: "review",
    confirmation: output.confirmation,
  });
  expect(repeated.status).toBe(409);
  expect(mocks.createReview).toHaveBeenCalledTimes(1);
});

test("a verified GitHub result survives failed local recording", async () => {
  const output = await preview();
  mocks.record.mockImplementation(async (fn) => {
    if (
      getFunctionName(fn) ===
      getFunctionName(internal.reviewPublications.recover)
    )
      throw new Error("Convex unavailable");
    return mutationResult(fn);
  });
  const response = await post({
    reviewId: "review",
    confirmation: output.confirmation,
  });
  expect(response.status).toBe(200);
  expect((await response.json()).githubReview.id).toBe(9);
});

test("preview includes real truncation and unseen content changes still require a fresh confirmation", async () => {
  const long = {
    ...review,
    result: { ...review.result, summary: "x".repeat(70_000) },
  };
  savedReview(long);
  const output = await preview();
  expect(output.normal.body).toHaveLength(65_000);
  expect(output.fallback.body).toHaveLength(65_000);
  expect(output.normal.body.endsWith("…")).toBe(true);
  savedReview({
    ...long,
    result: { ...long.result, summary: long.result.summary + "tail changed" },
  });
  expect(
    (await post({ reviewId: "review", confirmation: output.confirmation }))
      .status,
  ).toBe(409);
  expect(mocks.createReview).not.toHaveBeenCalled();
});
