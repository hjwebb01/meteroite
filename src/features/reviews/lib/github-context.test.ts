// @vitest-environment node
import { describe, expect, test, vi } from "vitest";
import type { Octokit } from "octokit";
import { buildHunks } from "../../../../convex/lib/review_navigation";
import {
  assignReviewParts,
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

async function snapshotWithContents(
  g: ReturnType<typeof github>,
  contents: Record<string, string>,
) {
  g.listFiles.mockResolvedValue({ data: [] });
  g.compare.mockRejectedValue(new Error("comparison unavailable"));
  g.getTree.mockResolvedValue({
    data: {
      truncated: false,
      tree: Object.entries(contents)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([path, text]) => ({
          type: "blob",
          mode: "100644",
          path,
          sha: path,
          size: Buffer.byteLength(text),
        })),
    },
  });
  g.getBlob.mockImplementation(async ({ file_sha }) => {
    const text = contents[file_sha];
    return {
      data: {
        encoding: "base64",
        size: Buffer.byteLength(text),
        content: Buffer.from(text).toString("base64"),
      },
    } as never;
  });
  return loadPullRequest(g.client, "owner", "app", 7);
}

function realisticPatch(label: string, count = 1_400) {
  const additions = Array.from(
    { length: count },
    (_, index) =>
      `export function ${label}Policy${index}(user: User, resource: Resource) { return canAccess(user, resource, "review:source:${index}"); }`,
  );
  return `@@ -1 +1,${count} @@\n-oldAuth();\n${additions.map((line) => `+${line}`).join("\n")}`;
}

describe("pinned repository investigation", () => {
  test("preserves anchors for a diff omitted from the prompt and accepts inspected evidence", async () => {
    const g = github();
    g.listFiles.mockResolvedValue({
      data: [
        {
          filename: "src/auth.ts",
          status: "modified",
          patch: realisticPatch("authorization"),
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
        [{ ...result.findings[0], line: 2_000 }],
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
          patch: realisticPatch("authorization"),
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
    expect(large.files[0].patch).toContain("authorizationPolicy1399");
    expect(small.warnings[0]).toContain("diff token budget");
    expect(large.warnings).toEqual([]);
  });
  test("a diff beyond one context is packed into review parts instead of omitted", async () => {
    const g = github();
    const patch = (body: string) =>
      realisticPatch(`part${body.replace(/\W/g, "")}`, 300);
    g.listFiles.mockResolvedValue({
      data: [
        { filename: "src/a.ts", status: "modified", patch: patch("a();") },
        { filename: "src/b.ts", status: "modified", patch: patch("b();") },
        { filename: "src/c.ts", status: "modified", patch: patch("c();") },
        { filename: "package-lock.json", status: "modified", patch: "@@" },
      ],
    });
    const patchCost = (body: string) => {
      const value = patch(body);
      return estimateTokens(
        JSON.stringify({
          patch: value,
          hunks: buildHunks(
            { filename: "src/a.ts", patch: value },
            "head:base",
          ),
        }),
      );
    };
    const capacity = patchCost("a();") * 2 + 100;
    const single = await loadPullRequest(g.client, "o", "app", 7, capacity);
    expect(single.files.map((f) => f.part)).toEqual([
      0,
      0,
      undefined,
      undefined,
    ]);
    expect(single.warnings).toContain(
      "Diff omitted: src/c.ts (diff token budget).",
    );
    const split = await loadPullRequest(g.client, "o", "app", 7, capacity, 4);
    expect(split.files.map((f) => f.part)).toEqual([0, 0, 1, undefined]);
    expect(split.files[2].patch).toContain("partcPolicy0");
    expect(split.warnings).toEqual([
      "Diff omitted: package-lock.json (lockfile).",
    ]);
  });
  test("parts keep listing order, refill earlier parts once all are open, and skip oversized patches", () => {
    expect(assignReviewParts([6, 6, 3, 20, undefined], 10, 2)).toEqual([
      0,
      1,
      1,
      undefined,
      undefined,
    ]);
    expect(assignReviewParts([6, 6, 3], 10, 2)).toEqual([0, 1, 1]);
    expect(assignReviewParts([6, 9, 3], 10, 2)).toEqual([0, 1, 0]);
    expect(assignReviewParts([6, 6, 3], 10, 1)).toEqual([0, undefined, 0]);
  });
  test("a turn allowance caps reads until it is reset", async () => {
    const g = github();
    const text = "newAuth();\nreturn user;\nreturn other;";
    g.getBlob.mockResolvedValue({
      data: {
        encoding: "base64",
        size: Buffer.byteLength(text),
        content: Buffer.from(text).toString("base64"),
      },
    });
    const snapshot = await loadPullRequest(g.client, "owner", "app", 7);
    const reader = createRepositoryReader(g.client, snapshot, async () => {});
    reader.limitTurn(estimateTokens(JSON.stringify("2: return user;\n")));
    expect(await reader.readFile("src/auth.ts", 1, 3)).toMatchObject({
      lastLine: 2,
      partial: true,
    });
    expect(reader.warnings).toContain(
      "Model input budget reached; investigation is partial.",
    );
    reader.limitTurn(Infinity);
    expect(await reader.readFile("src/auth.ts", 3, 3)).toMatchObject({
      content: "3: return other;",
    });
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
        note: expect.stringContaining(
          "supplied in the diff or earlier tool results",
        ),
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
  test("search returns a query-centered evidence window that a full read can upgrade", async () => {
    const g = github();
    const query = "lookupTarget";
    const line = `const record = { ${Array.from(
      { length: 80 },
      (_, index) => `field${index}: "meaningful source value ${index}"`,
    ).join(", ")} }; // ${query}`;
    const start = Math.max(
      0,
      Math.min(
        line.indexOf(query) - Math.floor((500 - query.length) / 2),
        line.length - 500,
      ),
    );
    const snippet = line.slice(start, start + 500);
    g.getBlob.mockResolvedValue({
      data: {
        encoding: "base64",
        size: Buffer.byteLength(`newAuth();\n${line}`),
        content: Buffer.from(`newAuth();\n${line}`).toString("base64"),
      },
    });
    const snapshot = await loadPullRequest(g.client, "owner", "app", 7);
    const reader = createRepositoryReader(g.client, snapshot, async () => {});
    expect(await reader.searchText(query, "src/")).toMatchObject({
      matches: [{ path: "src/auth.ts", line: 2, text: snippet }],
      scannedFiles: 1,
      nextCursor: null,
    });
    expect(snippet).toContain(query);
    expect(reader.evidence.get("src/auth.ts")?.get(2)).toBe(snippet);
    expect(await reader.searchText(query, "src/")).toEqual({
      matches: [],
      partial: false,
      alreadyRead: 1,
      scannedFiles: 1,
      scannedLines: 2,
      nextCursor: null,
    });
    expect(await reader.readFile("src/auth.ts", 2, 2)).toMatchObject({
      content: `2: ${line}`,
    });
    expect(reader.evidence.get("src/auth.ts")?.get(2)).toBe(line);
    expect(await reader.searchText(query, "src/")).toMatchObject({
      matches: [],
      partial: false,
      alreadyRead: 1,
    });
  });
  test("a distant search preserves evidence and advances past the line until a full read", async () => {
    const g = github();
    const middle = Array.from(
      { length: 90 },
      (_, index) => `field${index}: "meaningful source value ${index}"`,
    ).join(", ");
    const line = `const record = { firstTarget: "start", ${middle}, secondTarget: "end" };`;
    const text = `newAuth();\n${line}`;
    g.getBlob.mockResolvedValue({
      data: {
        encoding: "base64",
        size: Buffer.byteLength(text),
        content: Buffer.from(text).toString("base64"),
      },
    });
    const snapshot = await loadPullRequest(g.client, "owner", "app", 7);
    const reader = createRepositoryReader(g.client, snapshot, async () => {});

    await reader.searchText("firstTarget", "src/");
    const firstEvidence = reader.evidence.get("src/auth.ts")?.get(2);
    expect(firstEvidence).toContain("firstTarget");
    const second = await reader.searchText("secondTarget", "src/");
    expect(second).toMatchObject({
      matches: [],
      partial: true,
      nextCursor: { fileOffset: 0, lineOffset: 2 },
      requiredRead: { path: "src/auth.ts", line: 2 },
      error: expect.stringContaining("readFile"),
    });
    expect(reader.evidence.get("src/auth.ts")?.get(2)).toBe(firstEvidence);

    await reader.readFile("src/auth.ts", 2, 2);
    expect(reader.evidence.get("src/auth.ts")?.get(2)).toBe(line);
    expect(await reader.searchText("secondTarget", "src/")).toMatchObject({
      matches: [],
      partial: false,
      alreadyRead: 1,
    });
  });
  test("a conflicting oversized line does not trap search continuation", async () => {
    const g = github();
    const longLine = `firstTarget ${"source value ".repeat(15_000)} secondTarget`;
    const snapshot = await snapshotWithContents(g, {
      "src/large.ts": `${longLine}\nsecondTarget on the next line`,
    });
    const reader = createRepositoryReader(
      g.client,
      snapshot,
      async () => {},
      50_000,
    );
    reader.limitTurn(5_000);
    await reader.searchText("firstTarget", "src/");
    const conflict = await reader.searchText("secondTarget", "src/");
    expect(conflict).toMatchObject({
      partial: true,
      nextCursor: { fileOffset: 0, lineOffset: 1 },
    });
    expect(await reader.readFile("src/large.ts", 1, 1)).toMatchObject({
      partial: true,
    });
    const continued = await reader.searchText(
      "secondTarget",
      "src/",
      conflict.nextCursor!,
    );
    expect(continued).toMatchObject({
      partial: true,
      nextCursor: null,
      matches: [expect.objectContaining({ line: 2 })],
    });
    expect(reader.evidence.get("src/large.ts")?.get(1)).toContain(
      "firstTarget",
    );
    expect(
      [...reader.warnings].some((w) =>
        w.startsWith('Search for "secondTarget"'),
      ),
    ).toBe(true);
  });

  test("search read exhaustion preserves the first unread file cursor and partial coverage", async () => {
    const g = github();
    const contents = Object.fromEntries(
      Array.from({ length: 70 }, (_, i) => [
        `src/file${String(i).padStart(2, "0")}.ts`,
        i === 65 ? "lateTarget" : "unrelated",
      ]),
    );
    const snapshot = await snapshotWithContents(g, contents);
    const reader = createRepositoryReader(g.client, snapshot, async () => {});
    const first = await reader.searchText("lateTarget", "src/");
    const second = await reader.searchText(
      "lateTarget",
      "src/",
      first.nextCursor!,
    );
    const third = await reader.searchText(
      "lateTarget",
      "src/",
      second.nextCursor!,
    );
    expect(await reader.readFile("src/file65.ts", 1, 1)).toMatchObject({
      partial: true,
      error: "Repository read limit reached; this file was not read.",
    });
    expect(third).toMatchObject({
      partial: true,
      matches: [],
      nextCursor: { fileOffset: 60, lineOffset: 0 },
      error: expect.stringContaining("read limit"),
    });
    expect(
      [...reader.warnings].some((w) => w.startsWith('Search for "lateTarget"')),
    ).toBe(true);
  });

  test("a skipped or forged cursor cannot clear an unfinished search warning", async () => {
    const g = github();
    const snapshot = await snapshotWithContents(
      g,
      Object.fromEntries(
        Array.from({ length: 30 }, (_, i) => [`src/file${i}.ts`, "unrelated"]),
      ),
    );
    const reader = createRepositoryReader(g.client, snapshot, async () => {});
    const first = await reader.searchText("missingTarget", "src/");
    expect(
      await reader.searchText("missingTarget", "src/", {
        fileOffset: 100,
        lineOffset: 0,
      }),
    ).toMatchObject({
      partial: true,
      nextCursor: first.nextCursor,
      error: expect.stringContaining("without skipping"),
    });
    expect(
      [...reader.warnings].some((w) =>
        w.startsWith('Search for "missingTarget"'),
      ),
    ).toBe(true);
    expect(
      await reader.searchText("missingTarget", "src/", first.nextCursor!),
    ).toMatchObject({ partial: false });
    expect(
      [...reader.warnings].some((w) =>
        w.startsWith('Search for "missingTarget"'),
      ),
    ).toBe(false);
  });

  test("a stale cursor cannot mark a completed search partial", async () => {
    const g = github();
    const snapshot = await snapshotWithContents(g, {
      "src/file.ts": "unrelated",
    });
    const reader = createRepositoryReader(g.client, snapshot, async () => {});
    expect(await reader.searchText("missingTarget", "src/")).toMatchObject({
      partial: false,
    });
    expect(
      await reader.searchText("missingTarget", "src/", {
        fileOffset: 99,
        lineOffset: 0,
      }),
    ).toMatchObject({
      partial: false,
      nextCursor: null,
      error: expect.stringContaining("without skipping"),
    });
    expect(
      [...reader.warnings].some((w) =>
        w.startsWith('Search for "missingTarget"'),
      ),
    ).toBe(false);
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
  test("search checks cancellation even when its file is cached", async () => {
    const g = github();
    const active = vi.fn().mockResolvedValue(undefined);
    const snapshot = await loadPullRequest(g.client, "owner", "app", 7);
    const reader = createRepositoryReader(g.client, snapshot, active);
    await reader.searchText("user", "src/");
    active.mockRejectedValue(new Error("Cancelled"));
    await expect(reader.searchText("user", "src/")).rejects.toThrow(
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
    const firstPage = await reader.searchText("match", "src/");
    const matchWarning =
      'Search for "match" under src/ is partial; follow nextCursor when available and inspect reported limits.';
    expect(reader.warnings).toContain(matchWarning);
    expect(firstPage).toMatchObject({
      matches: Array.from({ length: 20 }, (_, i) => ({
        path: "src/auth.ts",
        line: i + 2,
        text: `match ${i}`,
      })),
      partial: true,
      nextCursor: { fileOffset: 0, lineOffset: 21 },
    });
    expect(
      await reader.searchText("match", "src/", firstPage.nextCursor!),
    ).toEqual({
      matches: [{ path: "src/auth.ts", line: 22, text: "match 20" }],
      partial: false,
      scannedFiles: 1,
      scannedLines: 1,
      nextCursor: null,
    });
    expect(reader.warnings).not.toContain(matchWarning);
  });
  test("search pagination reaches files beyond the first 25 in pinned path order", async () => {
    const g = github();
    const contents = Object.fromEntries(
      Array.from({ length: 26 }, (_, index) => [
        `src/file-${String(index).padStart(2, "0")}.ts`,
        index === 25
          ? 'export const result = "lateTarget";'
          : `export const value${index} = "ordinary source ${index}";`,
      ]),
    );
    const snapshot = await snapshotWithContents(g, contents);
    const reader = createRepositoryReader(g.client, snapshot, async () => {});

    const first = await reader.searchText("lateTarget", "src/");
    const lateWarning =
      'Search for "lateTarget" under src/ is partial; follow nextCursor when available and inspect reported limits.';
    expect(reader.warnings).toContain(lateWarning);
    expect(first).toMatchObject({
      matches: [],
      partial: true,
      scannedFiles: 25,
      nextCursor: { fileOffset: 25, lineOffset: 0 },
    });
    expect(
      await reader.searchText("lateTarget", "src/", first.nextCursor!),
    ).toMatchObject({
      matches: [
        {
          path: "src/file-25.ts",
          line: 1,
          text: 'export const result = "lateTarget";',
        },
      ],
      partial: false,
      scannedFiles: 1,
      nextCursor: null,
    });
    expect(reader.warnings).not.toContain(lateWarning);
  });
  test("completed searches clear only their own partial coverage warning", async () => {
    const g = github();
    const contents = Object.fromEntries(
      Array.from({ length: 26 }, (_, index) => [
        `src/file-${String(index).padStart(2, "0")}.ts`,
        `export const value${index} = "ordinary source ${index}";`,
      ]),
    );
    const snapshot = await snapshotWithContents(g, contents);
    const reader = createRepositoryReader(g.client, snapshot, async () => {});
    const warning = (query: string) =>
      `Search for ${JSON.stringify(query)} under src/ is partial; follow nextCursor when available and inspect reported limits.`;

    const alpha = await reader.searchText("alphaSearch", "src/");
    const beta = await reader.searchText("betaSearch", "src/");
    expect(reader.warnings).toContain(warning("alphaSearch"));
    expect(reader.warnings).toContain(warning("betaSearch"));

    await reader.searchText("alphaSearch", "src/", alpha.nextCursor!);
    expect(reader.warnings).not.toContain(warning("alphaSearch"));
    expect(reader.warnings).toContain(warning("betaSearch"));

    await reader.searchText("betaSearch", "src/", beta.nextCursor!);
    expect(reader.warnings).not.toContain(warning("betaSearch"));
  });
  test("search resumes inside a file when the turn budget is exhausted", async () => {
    const g = github();
    const path = "src/search.ts";
    const snapshot = await snapshotWithContents(g, {
      [path]: "match first;\nmatch second;",
    });
    const firstMatchTokens = estimateTokens(
      JSON.stringify({ path, line: 1, text: "match first;" }),
    );
    const reader = createRepositoryReader(
      g.client,
      snapshot,
      async () => {},
      firstMatchTokens * 2 + 100,
    );
    reader.limitTurn(firstMatchTokens);

    const first = await reader.searchText("match", "src/");
    expect(first).toMatchObject({
      matches: [{ path, line: 1, text: "match first;" }],
      partial: true,
      error: "Repository token budget reached.",
      nextCursor: { fileOffset: 0, lineOffset: 1 },
    });
    reader.limitTurn(Infinity);
    expect(
      await reader.searchText("match", "src/", first.nextCursor!),
    ).toMatchObject({
      matches: [{ path, line: 2, text: "match second;" }],
      partial: false,
      nextCursor: null,
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
      scannedFiles: 1,
      scannedLines: 2,
      nextCursor: null,
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
