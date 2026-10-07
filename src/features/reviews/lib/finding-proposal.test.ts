// @vitest-environment node
import { expect, test } from "vitest";
import type { Octokit } from "octokit";
import { canonicalProposal, proposalDigest } from "./finding-proposal";
const source = { sourceSha: "head", sourceOwner: "fork", sourceRepo: "app" };
function github(mode = "100644", original = "old\n") {
  return {
    rest: {
      git: {
        getTree: async () => ({
          data: {
            truncated: false,
            tree: [
              {
                path: "file.js",
                type: "blob",
                mode,
                sha: "blob",
                size: original.length,
              },
            ],
          },
        }),
        getBlob: async () => ({
          data: {
            encoding: "base64",
            content: Buffer.from(original).toString("base64"),
          },
        }),
      },
    },
  } as unknown as Octokit;
}
test("canonical full replacement/deletion records expected source blobs and deterministic server digest", async () => {
  const proposal = await canonicalProposal(github(), source, {
    rationale: "Fix finding",
    files: [
      { path: "new.js", replacement: "new\n" },
      { path: "file.js", replacement: null },
    ],
    checks: [],
  });
  expect(proposal.files).toEqual([
    {
      path: "file.js",
      expectedBlobSha: "blob",
      original: "old\n",
      replacement: null,
    },
    {
      path: "new.js",
      expectedBlobSha: null,
      original: null,
      replacement: "new\n",
    },
  ]);
  expect(proposal.digest).toBe(
    proposalDigest("head", proposal.files.toReversed()),
  );
  expect(proposal.digest).not.toBe(proposalDigest("other", proposal.files));
});
test("binary, symlink, executable, escaping and unchanged proposals fail closed", async () => {
  for (const mode of ["120000", "100755"])
    await expect(
      canonicalProposal(github(mode), source, {
        rationale: "Fix",
        files: [{ path: "file.js", replacement: "new" }],
        checks: [],
      }),
    ).rejects.toThrow("regular");
  await expect(
    canonicalProposal(github("100644", "bad\0"), source, {
      rationale: "Fix",
      files: [{ path: "file.js", replacement: "new" }],
      checks: [],
    }),
  ).rejects.toThrow("Binary");
  for (const path of ["../escape", ".git/config", "a//b", "/absolute"])
    await expect(
      canonicalProposal(github(), source, {
        rationale: "Fix",
        files: [{ path, replacement: "new" }],
        checks: [],
      }),
    ).rejects.toThrow("path");
  await expect(
    canonicalProposal(github(), source, {
      rationale: "Fix",
      files: [{ path: "file.js", replacement: "old\n" }],
      checks: [],
    }),
  ).rejects.toThrow("no change");
});

test("paths beneath gitlink submodules cannot be regular-file proposals", async () => {
  const octokit = {
    rest: {
      git: {
        getTree: async () => ({
          data: {
            truncated: false,
            tree: [
              {
                path: "vendor/module",
                type: "commit",
                mode: "160000",
                sha: "gitlink",
              },
            ],
          },
        }),
      },
    },
  } as unknown as Octokit;
  await expect(
    canonicalProposal(octokit, source, {
      rationale: "Fix",
      files: [{ path: "vendor/module/file.js", replacement: "new" }],
      checks: [],
    }),
  ).rejects.toThrow("submodule parents");
});
