import { createHash } from "node:crypto";
import { z } from "zod";
import type { Octokit } from "octokit";
export const proposedChangeSchema = z.object({
  rationale: z.string().min(1).max(4000),
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(500),
        replacement: z.string().max(100000).nullable(),
      }),
    )
    .min(1)
    .max(8),
  checks: z.array(z.array(z.string().max(2000)).min(1).max(20)).max(4),
});
export type ProposalFile = {
  path: string;
  expectedBlobSha: string | null;
  original: string | null;
  replacement: string | null;
};
export function proposalDigest(sourceSha: string, files: ProposalFile[]) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        sourceSha,
        files: files
          .map(({ path, expectedBlobSha, replacement }) => ({
            path,
            expectedBlobSha,
            replacement,
          }))
          .sort((a, b) => a.path.localeCompare(b.path)),
      }),
    )
    .digest("hex");
}
export async function canonicalProposal(
  octokit: Octokit,
  source: { sourceSha: string; sourceOwner: string; sourceRepo: string },
  changes: z.infer<typeof proposedChangeSchema>,
) {
  const { data: tree } = await octokit.rest.git.getTree({
    owner: source.sourceOwner,
    repo: source.sourceRepo,
    tree_sha: source.sourceSha,
    recursive: "true",
  });
  if (tree.truncated) throw new Error("Complete source tree is unavailable");
  const paths = new Set<string>();
  const files: ProposalFile[] = [];
  let bytes = 0;
  for (const change of changes.files) {
    if (
      !/^[A-Za-z0-9_.@/-]+$/.test(change.path) ||
      change.path.startsWith("/") ||
      change.path
        .split("/")
        .some(
          (p) => !p || p === "." || p === ".." || p.toLowerCase() === ".git",
        ) ||
      paths.has(change.path)
    )
      throw new Error("Unsupported proposal path");
    paths.add(change.path);
    const entry = tree.tree.find((f) => f.path === change.path);
    if (
      entry &&
      (entry.type !== "blob" ||
        entry.mode !== "100644" ||
        !entry.sha ||
        (entry.size ?? 0) > 100000)
    )
      throw new Error("Only regular non-executable text files can be proposed");
    if (
      tree.tree.some(
        (f) =>
          (f.mode === "120000" || f.mode === "160000" || f.type === "commit") &&
          change.path.startsWith(f.path + "/"),
      )
    )
      throw new Error("Symlink and submodule parents are unsupported");
    let original: string | null = null;
    if (entry) {
      const { data: blob } = await octokit.rest.git.getBlob({
        owner: source.sourceOwner,
        repo: source.sourceRepo,
        file_sha: entry.sha!,
      });
      if (blob.encoding !== "base64")
        throw new Error("Unsupported blob encoding");
      const buffer = Buffer.from(blob.content, "base64");
      original = buffer.toString("utf8");
      if (!Buffer.from(original).equals(buffer) || original.includes("\0"))
        throw new Error("Binary source is unsupported");
    }
    if (
      change.replacement !== null &&
      Buffer.from(change.replacement).toString("utf8") !== change.replacement
    )
      throw new Error("Replacement must be valid UTF-8 text");
    if (change.replacement?.includes("\0"))
      throw new Error("Binary replacements are unsupported");
    if (original === change.replacement)
      throw new Error("Proposal contains no change");
    bytes +=
      Buffer.byteLength(original ?? "") +
      Buffer.byteLength(change.replacement ?? "");
    if (bytes > 250000) throw new Error("Proposal exceeds the text size limit");
    files.push({
      path: change.path,
      expectedBlobSha: entry?.sha ?? null,
      original,
      replacement: change.replacement,
    });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, digest: proposalDigest(source.sourceSha, files) };
}
