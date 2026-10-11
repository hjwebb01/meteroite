import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { RequestError } from "octokit";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  octokit: vi.fn(),
  query: vi.fn(),
  record: vi.fn(),
  listReviews: vi.fn(),
  createReview: vi.fn(),
}));
vi.mock("@/lib/convex-auth", () => ({ getConvexAuth: mocks.auth }));
vi.mock("@/lib/github", () => ({ createUserOctokit: mocks.octokit }));
vi.mock("convex/nextjs", () => ({ fetchQuery: mocks.query }));
vi.mock("@/lib/convex-client", () => ({
  getConvexAdminClient: () => ({ mutation: mocks.record }),
}));
import { POST } from "./route";

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
function savedReview(saved: object, verdicts: object = {}) {
  mocks.query.mockImplementation(async (_query, args: object) =>
    "id" in args ? saved : verdicts,
  );
}
beforeEach(() => {
  mocks.auth.mockResolvedValue({ userId: "alice", token: "jwt" });
  mocks.octokit.mockResolvedValue({
    paginate: (method: () => unknown) => method(),
    rest: {
      pulls: {
        listReviews: mocks.listReviews,
        createReview: mocks.createReview,
      },
    },
  });
  mocks.listReviews.mockResolvedValue([]);
  mocks.createReview.mockResolvedValue({
    data: { id: 9, html_url: "https://github.com/acme/shop/pull/7#r9" },
  });
  mocks.record.mockResolvedValue(null);
  savedReview(review, { "review:1": "incorrect" });
});
afterEach(() => {
  vi.resetAllMocks();
});

test("posts one COMMENT review on the reviewed commit without retracted findings and records it for the signed-in owner", async () => {
  const response = await post({ reviewId: "review", ownerId: "mallory" });
  expect(response.status).toBe(200);
  const { githubReview } = await response.json();
  expect(githubReview).toMatchObject({
    id: 9,
    url: "https://github.com/acme/shop/pull/7#r9",
    headSha: "abcdef1234",
  });
  for (const [, , options] of mocks.query.mock.calls)
    expect(options).toEqual({ token: "jwt" });
  expect(mocks.octokit).toHaveBeenCalledWith("alice");
  expect(mocks.createReview).toHaveBeenCalledOnce();
  const posted = mocks.createReview.mock.calls[0][0];
  expect(posted).toMatchObject({
    owner: "acme",
    repo: "shop",
    pull_number: 7,
    commit_id: "abcdef1234",
    event: "COMMENT",
  });
  expect(JSON.stringify(posted)).toContain("Discount applied twice");
  expect(JSON.stringify(posted)).not.toContain("Retracted claim");
  expect(mocks.record.mock.calls[0][1]).toMatchObject({
    id: "review",
    ownerId: "alice",
    githubReview: { id: 9, headSha: "abcdef1234" },
  });
});

test("unauthenticated, malformed and other owners' requests never reach GitHub", async () => {
  mocks.auth.mockResolvedValueOnce(null);
  expect((await post({ reviewId: "review" })).status).toBe(401);
  expect((await post({})).status).toBe(400);
  mocks.query.mockRejectedValue(new Error("Review not found"));
  const hidden = await post({ reviewId: "bobs-review" });
  expect(hidden.status).toBe(404);
  expect(mocks.octokit).not.toHaveBeenCalled();
  expect(mocks.createReview).not.toHaveBeenCalled();
});

test("only a completed, pinned review is posted, and a recorded post is not repeated", async () => {
  for (const pending of [
    { ...review, status: "running" },
    { ...review, headSha: undefined },
    { ...review, result: undefined },
  ]) {
    savedReview(pending);
    expect((await post({ reviewId: "review" })).status).toBe(409);
  }
  const githubReview = {
    id: 3,
    url: "https://github.com/acme/shop/pull/7#r3",
    headSha: "abcdef1234",
    postedAt: 1,
  };
  savedReview({ ...review, githubReview });
  const repeated = await post({ reviewId: "review" });
  expect(await repeated.json()).toEqual({ githubReview });
  expect(mocks.createReview).not.toHaveBeenCalled();
  expect(mocks.record).not.toHaveBeenCalled();
});

test("GitHub refusals give actionable errors and record nothing", async () => {
  mocks.createReview.mockRejectedValue(
    new RequestError("Forbidden", 403, {
      request: { method: "POST", url: "https://api.github.com", headers: {} },
    }),
  );
  const response = await post({ reviewId: "review" });
  expect(response.status).toBe(502);
  expect((await response.json()).error).toMatch(/cannot comment/);
  expect(mocks.record).not.toHaveBeenCalled();
});

test("a post that reached GitHub is reported even if recording it fails", async () => {
  mocks.record.mockRejectedValue(new Error("Convex unavailable"));
  const response = await post({ reviewId: "review" });
  expect(response.status).toBe(200);
  expect((await response.json()).githubReview.id).toBe(9);
});
