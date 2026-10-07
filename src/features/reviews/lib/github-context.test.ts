// @vitest-environment node
import { describe, expect, test, vi } from "vitest";
import type { Octokit } from "octokit";
import {
  createRepositoryReader,
  loadPullRequest,
  loadReviewSignals,
} from "./github-context";
import { validateFindings } from "./review";
import { createReviewBudget, estimateTokens } from "./context-budget";

function github() {
  const pr = {
    changed_files: 1,
    title: "Fix auth",
    body: "",
    base: { sha: "base" },
    head: {
      sha: "head",
      repo: { owner: { login: "fork-owner" }, name: "fork" },
    },
  };
  const get = vi.fn().mockResolvedValue({ data: pr });
  const listFiles = vi.fn().mockResolvedValue({
    data: [
      {
        filename: "src/auth.ts",
        sha: "blob-sha",
        status: "modified",
        patch: "@@ -1 +1 @@\n-oldAuth();\n+newAuth();",
      },
    ],
  });
  const getTree = vi.fn().mockResolvedValue({
    data: {
      truncated: false,
      tree: [
        {
          type: "blob",
          mode: "100644",
          path: "src/auth.ts",
          sha: "blob-sha",
          size: 20,
        },
      ],
    },
  });
  const getBlob = vi.fn().mockResolvedValue({
    data: {
      encoding: "base64",
      size: 20,
      content: Buffer.from("newAuth();\nreturn user;").toString("base64"),
    },
  });
  const compare = vi.fn(async () => ({
    data: {
      merge_base_commit: { sha: "merge-base" },
      files: (await listFiles()).data,
    },
  }));
  const client = {
    rest: {
      pulls: { get, listFiles },
      git: { getTree, getBlob },
      repos: {
        compareCommitsWithBasehead: compare,
      },
    },
  } as unknown as Octokit;
  return { client, pr, get, getTree, getBlob, listFiles, compare };
}

describe("pinned repository investigation", () => {
  test("preserves anchors for a diff omitted from the prompt and accepts inspected evidence", async () => {
    const g = github();
    g.listFiles.mockResolvedValue({
      data: [
        {
          filename: "src/auth.ts",
          status: "modified",
          patch: `@@ -1 +1 @@\n-oldAuth();\n+${"x".repeat(70_000)}`,
        },
      ],
    });
    const snapshot = await loadPullRequest(g.client, "base-owner", "app", 7);
    expect(snapshot.files[0].patch).toBeUndefined();
    const reader = createRepositoryReader(g.client, snapshot, async () => {});
    expect(reader.evidence.has("src/auth.ts")).toBe(false);
    await reader.readFile("src/auth.ts", 1, 1);
    const result = validateFindings(
      [
        {
          severity: "high",
          title: "Missing authorization",
          path: "src/auth.ts",
          line: 1,
          side: "RIGHT",
          explanation: "Trigger",
          suggestion: "Fix",
          evidence: [{ path: "src/auth.ts", line: 1, quote: "newAuth();" }],
          previousFindingId: null,
        },
      ],
      snapshot.files,
      reader.evidence,
      [],
      "run",
    );
    expect(result.rejected).toBe(0);
    expect(result.findings).toHaveLength(1);
    expect(
      validateFindings(
        [{ ...result.findings[0], line: 2 }],
        snapshot.files,
        reader.evidence,
        [],
        "run",
      ).rejected,
    ).toBe(1);
  });
  test("a larger model budget includes a diff that a smaller model omits", async () => {
    const g = github();
    g.listFiles.mockResolvedValue({
      data: [
        {
          filename: "src/auth.ts",
          status: "modified",
          patch: `@@ -1 +1 @@\n-oldAuth();\n+${"x".repeat(70_000)}`,
        },
      ],
    });
    const small = await loadPullRequest(
      g.client,
      "owner",
      "app",
      7,
      createReviewBudget(32_000).diffTokens,
    );
    const large = await loadPullRequest(
      g.client,
      "owner",
      "app",
      7,
      createReviewBudget(1_050_000).diffTokens,
    );
    expect(small.files[0].patch).toBeUndefined();
    expect(small.files[0].anchors).toEqual(large.files[0].anchors);
    expect(large.files[0].patch).toContain("x".repeat(70_000));
    expect(small.warnings[0]).toContain("diff token budget");
    expect(large.warnings).toEqual([]);
  });
  test("overlapping and repeated windows only consume budget for newly delivered lines", async () => {
    const g = github();
    g.getBlob.mockResolvedValue({
      data: {
        encoding: "base64",
        size: 100,
        content: Buffer.from(
          "newAuth();\nreturn user;\nreturn other;",
        ).toString("base64"),
      },
    });
    const snapshot = await loadPullRequest(g.client, "owner", "app", 7);
    const budget =
      estimateTokens(JSON.stringify("2: return user;\n")) +
      estimateTokens(JSON.stringify("3: return other;\n"));
    const reader = createRepositoryReader(
      g.client,
      snapshot,
      async () => {},
      budget,
    );
    expect(await reader.readFile("src/auth.ts", 1, 2)).toMatchObject({
      content: "2: return user;",
      alreadyRead: 1,
      lastLine: 2,
    });
    for (let i = 0; i < 10; i++)
      expect(await reader.readFile("src/auth.ts", 1, 2)).toMatchObject({
        content: "",
        alreadyRead: 2,
        lastLine: 2,
      });
    expect(await reader.readFile("src/auth.ts", 2, 3)).toMatchObject({
      content: "3: return other;",
      alreadyRead: 1,
      lastLine: 3,
    });
    expect(reader.warnings.size).toBe(0);
    expect(g.getBlob).toHaveBeenCalledTimes(1);
  });
  test("an exhausted budget reports partial coverage without recording unseen evidence", async () => {
    const g = github();
    const snapshot = await loadPullRequest(g.client, "owner", "app", 7);
    const reader = createRepositoryReader(
      g.client,
      snapshot,
      async () => {},
      0,
    );
    expect(await reader.readFile("src/auth.ts", 2, 2)).toMatchObject({
      content: "",
      lastLine: 1,
      partial: true,
      error: "Repository token budget reached.",
    });
    expect(reader.evidence.get("src/auth.ts")?.has(2)).toBe(false);
    expect(reader.filesRead.size).toBe(0);
    expect([...reader.warnings]).toContain(
      "Repository token budget reached; investigation is partial.",
    );
  });
  test("search delivers truncated evidence once and a full read can upgrade it", async () => {
    const g = github();
    const line = `return user;${"x".repeat(1_000)}`;
    g.getBlob.mockResolvedValue({
      data: {
        encoding: "base64",
        size: line.length + 11,
        content: Buffer.from(`newAuth();\n${line}`).toString("base64"),
      },
    });
    const snapshot = await loadPullRequest(g.client, "owner", "app", 7);
    const reader = createRepositoryReader(g.client, snapshot, async () => {});
    expect(await reader.searchText("user", "src/")).toMatchObject({
      matches: [{ path: "src/auth.ts", line: 2, text: line.slice(0, 500) }],
    });
    expect(reader.evidence.get("src/auth.ts")?.get(2)).toBe(line.slice(0, 500));
    expect(await reader.searchText("user", "src/")).toEqual({
      matches: [],
      partial: false,
      alreadyRead: 1,
    });
    expect(await reader.readFile("src/auth.ts", 2, 2)).toMatchObject({
      content: `2: ${line}`,
    });
    expect(reader.evidence.get("src/auth.ts")?.get(2)).toBe(line);
  });
  test("cancellation is checked even for cached files", async () => {
    const g = github();
    const active = vi.fn().mockResolvedValue(undefined);
    const snapshot = await loadPullRequest(g.client, "owner", "app", 7);
    const reader = createRepositoryReader(g.client, snapshot, active);
    await reader.readFile("src/auth.ts", 1, 2);
    active.mockRejectedValue(new Error("Cancelled"));
    await expect(reader.readFile("src/auth.ts", 1, 2)).rejects.toThrow(
      "Cancelled",
    );
  });
  test("repeating a capped search advances past previously delivered matches", async () => {
    const g = github();
    const text = [
      "newAuth();",
      ...Array.from({ length: 21 }, (_, i) => `match ${i}`),
    ].join("\n");
    g.getBlob.mockResolvedValue({
      data: {
        encoding: "base64",
        size: text.length,
        content: Buffer.from(text).toString("base64"),
      },
    });
    const snapshot = await loadPullRequest(g.client, "owner", "app", 7);
    const reader = createRepositoryReader(g.client, snapshot, async () => {});
    expect(await reader.searchText("match", "src/")).toMatchObject({
      matches: Array.from({ length: 20 }, (_, i) => ({
        path: "src/auth.ts",
        line: i + 2,
        text: `match ${i}`,
      })),
      partial: true,
    });
    expect(await reader.searchText("match", "src/")).toEqual({
      matches: [{ path: "src/auth.ts", line: 22, text: "match 20" }],
      partial: false,
      alreadyRead: 20,
    });
  });
  test("rejects a PR that changes while its diff is being fetched", async () => {
    const g = github();
    g.get.mockResolvedValueOnce({ data: g.pr }).mockResolvedValueOnce({
      data: { ...g.pr, head: { ...g.pr.head, sha: "new-head" } },
    });
    await expect(
      loadPullRequest(g.client, "base-owner", "app", 7),
    ).rejects.toThrow("PR changed");
    expect(g.getTree).not.toHaveBeenCalled();
  });
  test("fetches fork context using immutable blob IDs and validates line windows", async () => {
    const g = github();
    const snapshot = await loadPullRequest(g.client, "base-owner", "app", 7);
    const reader = createRepositoryReader(g.client, snapshot, async () => {});
    const window = await reader.readFile("src/auth.ts", 2, 2);
    expect(window).toMatchObject({ content: "2: return user;", lastLine: 2 });
    expect(g.getBlob).toHaveBeenCalledWith({
      owner: "fork-owner",
      repo: "fork",
      file_sha: "blob-sha",
    });
    expect(reader.evidence.get("src/auth.ts")?.get(2)).toBe("return user;");
    expect(await reader.readFile("src/auth.ts", 2, 1)).toHaveProperty("error");
    expect(await reader.readFile("missing.ts")).toHaveProperty("error");
  });
  test("search evidence is limited to actual returned source lines", async () => {
    const g = github();
    const snapshot = await loadPullRequest(g.client, "base-owner", "app", 7);
    const reader = createRepositoryReader(g.client, snapshot, async () => {});
    expect(await reader.searchText("user", "src/")).toEqual({
      matches: [{ path: "src/auth.ts", line: 2, text: "return user;" }],
      partial: false,
    });
    expect([...reader.filesRead]).toEqual(["src/auth.ts"]);
  });
  test("cancellation prevents another repository read", async () => {
    const g = github();
    const snapshot = await loadPullRequest(g.client, "base-owner", "app", 7);
    const reader = createRepositoryReader(g.client, snapshot, async () => {
      throw new Error("Cancelled");
    });
    await expect(reader.readFile("src/auth.ts")).rejects.toThrow("Cancelled");
    expect(g.getBlob).not.toHaveBeenCalled();
  });
});

describe("pinned readiness observations", () => {
  function client(
    runs: { status: string; conclusion: string | null }[],
    status: { state: string; total_count: number },
  ) {
    const paginate = vi.fn().mockResolvedValue(runs);
    const getStatus = vi.fn().mockResolvedValue({ data: status });
    return {
      paginate,
      getStatus,
      client: {
        paginate,
        rest: {
          checks: { listForRef: vi.fn() },
          repos: { getCombinedStatusForRef: getStatus },
        },
      } as unknown as Octokit,
    };
  }
  test.each([
    {
      runs: [{ status: "completed", conclusion: "success" }],
      status: { state: "pending", total_count: 0 },
      expected: "passed",
    },
    {
      runs: [{ status: "completed", conclusion: "failure" }],
      status: { state: "success", total_count: 1 },
      expected: "failed",
    },
    {
      runs: [{ status: "in_progress", conclusion: null }],
      status: { state: "pending", total_count: 0 },
      expected: "pending",
    },
    {
      runs: [],
      status: { state: "pending", total_count: 0 },
      expected: "none",
    },
    {
      runs: [],
      status: { state: "success", total_count: 1 },
      expected: "passed",
    },
    {
      runs: [],
      status: { state: "failure", total_count: 1 },
      expected: "failed",
    },
  ])(
    "records $expected from checks and commit statuses at the exact head",
    async ({ runs, status, expected }) => {
      const g = client(runs, status);
      const observed = await loadReviewSignals(
        g.client,
        "base-owner",
        "app",
        "pinned-head",
        false,
        100,
      );
      expect(observed).toMatchObject({
        draft: {
          state: "known",
          value: false,
          headSha: "pinned-head",
          observedAt: 100,
        },
        checks: { state: "known", value: expected, headSha: "pinned-head" },
      });
      expect(g.getStatus).toHaveBeenCalledWith({
        owner: "base-owner",
        repo: "app",
        ref: "pinned-head",
      });
      expect(g.paginate.mock.calls[0][1].ref).toBe("pinned-head");
    },
  );
  test("keeps unavailable checks and unknown draft explicit", async () => {
    const g = client([], { state: "pending", total_count: 0 });
    g.paginate.mockRejectedValue(new Error("Forbidden"));
    expect(
      await loadReviewSignals(
        g.client,
        "base-owner",
        "app",
        "head",
        undefined,
        100,
      ),
    ).toMatchObject({
      draft: { state: "unknown", headSha: "head" },
      checks: { state: "unavailable", headSha: "head" },
    });
  });
  test("an unknown completed check never becomes a passing observation", async () => {
    const g = client([{ status: "completed", conclusion: null }], {
      state: "success",
      total_count: 1,
    });
    expect(
      await loadReviewSignals(g.client, "base-owner", "app", "head", true, 100),
    ).toMatchObject({
      draft: { state: "known", value: true },
      checks: { state: "unavailable" },
    });
  });
});

test("proves the diff LEFT ancestor independently of the current base tip", async () => {
  const g = github();
  const snapshot = await loadPullRequest(g.client, "base-owner", "app", 7);
  expect(snapshot.baseTipSha).toBe("base");
  expect(snapshot.baseSha).toBe("base");
  expect(snapshot.diffLeftSha).toBe("merge-base");
  expect(g.getTree).toHaveBeenCalledWith(
    expect.objectContaining({
      owner: "base-owner",
      repo: "app",
      tree_sha: "merge-base",
    }),
  );
  expect(snapshot.diffs[0].leftBlobSha).toBe("blob-sha");
});
test("withholds LEFT provenance when comparison patches disagree with the saved diff", async () => {
  const g = github();
  g.compare.mockResolvedValue({
    data: {
      merge_base_commit: { sha: "different" },
      files: [
        {
          filename: "src/auth.ts",
          status: "modified",
          patch: "@@ -1 +1 @@\n-other();\n+different();",
        },
      ],
    },
  });
  const snapshot = await loadPullRequest(g.client, "owner", "app", 7);
  expect(snapshot.diffLeftSha).toBeUndefined();
  expect(snapshot.diffs[0].patch).toContain("newAuth");
  expect(
    snapshot.warnings.some((warning) => warning.includes("LEFT-side")),
  ).toBe(true);
});

test("fork comparison explicitly names the source owner", async () => {
  const g = github();
  await loadPullRequest(g.client, "base-owner", "app", 7);
  expect(g.compare).toHaveBeenCalledWith(
    expect.objectContaining({
      owner: "base-owner",
      repo: "app",
      basehead: "base...fork-owner:head",
    }),
  );
});
test("a truncated ancestor tree leaves new LEFT provenance unavailable", async () => {
  const g = github();
  g.getTree.mockResolvedValueOnce({ data: { truncated: true, tree: [] } });
  const snapshot = await loadPullRequest(g.client, "base-owner", "app", 7);
  expect(snapshot.diffLeftSha).toBeUndefined();
  expect(snapshot.files[0].leftBlobSha).toBeUndefined();
  expect(
    snapshot.warnings.some((warning) => warning.includes("LEFT-side")),
  ).toBe(true);
});
