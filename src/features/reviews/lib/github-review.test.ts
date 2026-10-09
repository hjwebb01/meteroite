import { describe, expect, test, vi } from "vitest";
import { RequestError, type Octokit } from "octokit";
import type { Doc } from "../../../../convex/_generated/dataModel";
import type { Finding } from "./finding-presentation";
import {
  buildGithubReview,
  publishGithubReview,
  reviewMarker,
} from "./github-review";

const review = {
  _id: "review1",
  repoOwner: "acme",
  repoName: "shop",
  pullNumber: 7,
  headSha: "abcdef1234",
  result: { summary: "Adds discount codes." },
} as unknown as Doc<"reviews">;

const finding: Finding = {
  id: "r:0",
  severity: "high",
  category: "security",
  title: "Discount applied twice",
  path: "cart.ts",
  line: 12,
  side: "RIGHT",
  explanation: "The code is re-applied on refresh.",
  suggestion: "Store applied codes on the cart.",
  evidence: [{ path: "cart.ts", line: 12, quote: "applyDiscount(code)" }],
  previousFindingId: null,
};
const nitpick: Finding = {
  ...finding,
  id: "r:1",
  severity: "low",
  category: "maintainability",
  title: "Rename helper",
  line: 30,
};

describe("buildGithubReview", () => {
  test("anchors main findings inline and folds nitpicks into the summary", () => {
    const { body, comments } = buildGithubReview(review, [nitpick, finding]);
    expect(body).toContain(reviewMarker("review1"));
    expect(body).toContain("Adds discount codes.");
    expect(body).toContain("1 high, 1 low (1 nitpick below)");
    expect(body).toMatch(/<details>[\s\S]*Rename helper[\s\S]*<\/details>/);
    expect(comments).toEqual([
      {
        path: "cart.ts",
        line: 12,
        side: "RIGHT",
        body: expect.stringContaining(
          "**High · Security: Discount applied twice**",
        ),
      },
    ]);
  });

  test("without inline anchors every finding lands in the summary", () => {
    const { body, comments } = buildGithubReview(review, [finding], {
      inline: false,
    });
    expect(comments).toEqual([]);
    expect(body).toContain("`cart.ts:12`");
    expect(body).toContain("Store applied codes on the cart.");
  });
});

function fakeOctokit(posted: { body: string }[] = []) {
  const createReview = vi.fn().mockResolvedValue({
    data: { id: 9, html_url: "https://github.com/r/9" },
  });
  const octokit = {
    paginate: vi.fn().mockResolvedValue(
      posted.map((r, i) => ({ ...r, id: i, html_url: `https://g/${i}` })),
    ),
    rest: { pulls: { listReviews: {}, createReview } },
  } as unknown as Octokit;
  return { octokit, createReview };
}

describe("publishGithubReview", () => {
  test("posts a COMMENT review on the reviewed commit", async () => {
    const { octokit, createReview } = fakeOctokit();
    await expect(
      publishGithubReview(octokit, review, [finding]),
    ).resolves.toEqual({ id: 9, url: "https://github.com/r/9" });
    expect(createReview).toHaveBeenCalledWith(
      expect.objectContaining({
        commit_id: "abcdef1234",
        event: "COMMENT",
        pull_number: 7,
      }),
    );
  });

  test("reuses an unrecorded earlier post instead of posting twice", async () => {
    const { octokit, createReview } = fakeOctokit([
      { body: "unrelated" },
      { body: `${reviewMarker("review1")}\n## Meteroite review` },
    ]);
    await expect(
      publishGithubReview(octokit, review, [finding]),
    ).resolves.toEqual({ id: 1, url: "https://g/1" });
    expect(createReview).not.toHaveBeenCalled();
  });

  test("falls back to a summary-only review when an anchor fails", async () => {
    const { octokit, createReview } = fakeOctokit();
    createReview.mockRejectedValueOnce(
      new RequestError("Line could not be resolved", 422, {
        request: { method: "POST", url: "", headers: {} },
      }),
    );
    await publishGithubReview(octokit, review, [finding]);
    expect(createReview).toHaveBeenCalledTimes(2);
    expect(createReview.mock.calls[1][0].comments).toEqual([]);
  });
});
