// @vitest-environment node
import { expect, test, vi } from "vitest";
import type { Octokit } from "octokit";
import { createFindingReader } from "./finding-evidence";
const source = {
  headSha: "pinned-head",
  baseSha: "pinned-base",
  sourceOwner: "fork",
  sourceRepo: "app",
  repoOwner: "upstream",
  repoName: "app",
};
test("head and diff-left evidence use exact commits and immutable blob identity", async () => {
  const calls: unknown[] = [];
  const github = {
    rest: {
      repos: {
        compareCommitsWithBasehead: vi.fn().mockResolvedValue({
          data: { merge_base_commit: { sha: "merge-base" } },
        }),
      },
      git: {
        getTree: async (args: unknown) => {
          calls.push(args);
          return {
            data: {
              truncated: false,
              tree: [
                {
                  type: "blob",
                  mode: "100644",
                  path: "caller.ts",
                  sha: "blob-oid",
                  size: 30,
                },
              ],
            },
          };
        },
        getBlob: async () => ({
          data: {
            encoding: "base64",
            content: Buffer.from("if (!user) return;\ncall(user);").toString(
              "base64",
            ),
          },
        }),
      },
    },
  } as unknown as Octokit;
  const reader = await createFindingReader(github, source, async () => {});
  expect((await reader.readFile("head", "caller.ts", 1, 1)).content).toBe(
    "1: if (!user) return;",
  );
  expect((await reader.readFile("diffLeft", "caller.ts", 1, 1)).commit).toBe(
    "merge-base",
  );
  expect(calls).toEqual([
    { owner: "fork", repo: "app", tree_sha: "pinned-head", recursive: "true" },
    {
      owner: "upstream",
      repo: "app",
      tree_sha: "merge-base",
      recursive: "true",
    },
  ]);
  const result = reader.validate({
    verdict: "incorrect",
    explanation: "Guarded",
    evidence: [
      {
        revision: "head",
        path: "caller.ts",
        line: 1,
        quote: "if (!user) return;",
      },
    ],
    assumptions: [],
  });
  expect(result.evidence[0]).toEqual({
    revision: "head",
    path: "caller.ts",
    line: 1,
    quote: "if (!user) return;",
    commit: "pinned-head",
    blobSha: "blob-oid",
  });
  expect(result.assumptions).toEqual([
    "Static inspection only. No tests or runtime checks ran.",
  ]);
  expect(() =>
    reader.validate({
      ...result,
      evidence: [
        { revision: "head", path: "caller.ts", line: 2, quote: "call(user);" },
      ],
    }),
  ).toThrow("did not inspect");
});
test("cancellation stops reads even after repository discovery", async () => {
  let active = true;
  const github = {
    rest: {
      git: {
        getTree: vi
          .fn()
          .mockResolvedValue({ data: { truncated: false, tree: [] } }),
      },
    },
  } as unknown as Octokit;
  const reader = await createFindingReader(github, source, async () => {
    if (!active) throw new Error("Cancelled");
  });
  expect(await reader.listFiles("head", "src/")).toEqual({
    paths: [],
    total: 0,
    partial: false,
  });
  active = false;
  await expect(reader.readFile("head", "caller.ts", 1, 1)).rejects.toThrow(
    "Cancelled",
  );
});
