import { z } from "zod";
import type { Octokit } from "octokit";

export const conclusionSchema = z.object({
  verdict: z.enum([
    "supported",
    "incorrect",
    "could-not-reproduce",
    "inconclusive",
  ]),
  explanation: z.string().min(1).max(4000),
  evidence: z
    .array(
      z.object({
        revision: z.enum(["head", "diffLeft"]),
        path: z.string().max(500),
        line: z.number().int().positive(),
        quote: z.string().min(8).max(500),
      }),
    )
    .max(8),
  assumptions: z.array(z.string().max(500)).max(10),
});
export type PinnedFindingSource = {
  headSha: string;
  baseSha: string;
  sourceOwner: string;
  sourceRepo: string;
  repoOwner: string;
  repoName: string;
  diffLeftSha?: string;
};
export type FindingEvidence = z.infer<
  typeof conclusionSchema
>["evidence"][number] & { commit: string; blobSha: string };

export async function createFindingReader(
  octokit: Octokit,
  source: PinnedFindingSource,
  checkActive: () => Promise<void>,
) {
  const inspected = new Map<
    string,
    { commit: string; blobSha: string; lines: Map<number, string> }
  >();
  const trees = new Map<
    string,
    Array<{ path: string; sha: string; size: number }>
  >();
  let diffLeft = source.diffLeftSha;
  let reads = 0,
    deliveredBytes = 0;
  async function revision(which: "head" | "diffLeft") {
    await checkActive();
    if (which === "head")
      return {
        owner: source.sourceOwner,
        repo: source.sourceRepo,
        commit: source.headSha,
      };
    if (!diffLeft) {
      const { data } = await octokit.rest.repos.compareCommitsWithBasehead({
        owner: source.repoOwner,
        repo: source.repoName,
        basehead: `${source.baseSha}...${source.sourceOwner}:${source.headSha}`,
      });
      diffLeft = data.merge_base_commit.sha;
    }
    return { owner: source.repoOwner, repo: source.repoName, commit: diffLeft };
  }
  async function entries(which: "head" | "diffLeft") {
    const ref = await revision(which);
    const cached = trees.get(ref.commit);
    if (cached) return { ref, paths: cached };
    const { data } = await octokit.rest.git.getTree({
      owner: ref.owner,
      repo: ref.repo,
      tree_sha: ref.commit,
      recursive: "true",
    });
    if (data.truncated)
      throw new Error(
        "Pinned repository tree is truncated. Narrow the repository before investigating.",
      );
    const paths = data.tree
      .filter(
        (x) => x.type === "blob" && x.mode !== "120000" && x.path && x.sha,
      )
      .map((x) => ({ path: x.path!, sha: x.sha!, size: x.size ?? 0 }));
    trees.set(ref.commit, paths);
    return { ref, paths };
  }
  return {
    inspected,
    async listFiles(which: "head" | "diffLeft", prefix: string) {
      const { paths } = await entries(which);
      const matches = paths.filter((x) => x.path.startsWith(prefix));
      return {
        paths: matches.slice(0, 200).map((x) => x.path),
        total: matches.length,
        partial: matches.length > 200,
      };
    },
    async readFile(
      which: "head" | "diffLeft",
      path: string,
      startLine: number,
      endLine: number,
    ) {
      await checkActive();
      if (++reads > 40 || endLine < startLine)
        return { error: "Read limit reached or invalid line range." };
      const { ref, paths } = await entries(which);
      const entry = paths.find((x) => x.path === path);
      if (!entry || entry.size > 100_000)
        return { error: "Source is missing, binary, symlinked, or too large." };
      const { data } = await octokit.rest.git.getBlob({
        owner: ref.owner,
        repo: ref.repo,
        file_sha: entry.sha,
      });
      if (data.encoding !== "base64")
        return { error: "Unsupported blob encoding." };
      const bytes = Buffer.from(data.content, "base64");
      if (bytes.includes(0) || bytes.length > 100_000)
        return { error: "Source is binary or too large." };
      const lines = bytes.toString("utf8").split("\n");
      const last = Math.min(endLine, startLine + 149, lines.length);
      const numbered = lines
        .slice(startLine - 1, last)
        .map((text, i) => `${startLine + i}: ${text}`)
        .join("\n");
      deliveredBytes += Buffer.byteLength(numbered);
      if (deliveredBytes > 80_000)
        return { error: "Source evidence budget reached." };
      const key = `${which}:${path}`;
      const evidence = inspected.get(key) ?? {
        commit: ref.commit,
        blobSha: entry.sha,
        lines: new Map<number, string>(),
      };
      for (let line = startLine; line <= last; line++)
        evidence.lines.set(line, lines[line - 1]);
      inspected.set(key, evidence);
      return {
        revision: which,
        commit: ref.commit,
        blobSha: entry.sha,
        path,
        content: numbered,
        totalLines: lines.length,
      };
    },
    validate(draft: z.infer<typeof conclusionSchema>, executionRan = false) {
      const evidence: FindingEvidence[] = draft.evidence.map((e) => {
        const read = inspected.get(`${e.revision}:${e.path}`);
        if (
          !read ||
          !read.lines.get(e.line)?.includes(e.quote.trim()) ||
          e.quote.trim().length < 8
        )
          throw new Error("The response cites source it did not inspect.");
        return { ...e, commit: read.commit, blobSha: read.blobSha };
      });
      if (
        ["supported", "incorrect"].includes(draft.verdict) &&
        !evidence.length
      )
        throw new Error("A verdict change requires inspected source evidence.");
      return {
        ...draft,
        evidence,
        assumptions: [
          ...draft.assumptions,
          executionRan
            ? "Runtime checks are limited to the commands and results recorded with this investigation."
            : "Static inspection only. No tests or runtime checks ran.",
        ],
      };
    },
  };
}
