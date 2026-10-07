import type { Octokit } from "octokit";
import {
  changedLineRanges,
  buildHunks,
  type ChangeHunk,
  type FileCoverageGap,
} from "../../../../convex/lib/review_navigation";
import type { ReviewSignals } from "../../../../convex/lib/review_assessment";
import {
  changedLineAnchors,
  type ChangedFile,
  type EvidenceLines,
} from "./review";
import { createReviewBudget, estimateTokens } from "./context-budget";

const MAX_FILE_BYTES = 250_000;
const MAX_READS = 60;
// Keeps one stored diff well under Convex's 1 MiB document limit.
const MAX_DISPLAY_PATCH_CHARS = 400_000;

/** The full GitHub patch saved for display, including files the model was not given. */
export type ReviewFileDiff = {
  filename: string;
  previousFilename?: string;
  status: string;
  patch?: string;
  omittedReason?: string;
  coverageGaps?: FileCoverageGap[];
  headBlobSha?: string;
  leftBlobSha?: string;
  changedLineRanges?: ReturnType<typeof changedLineRanges>;
  hunks?: ChangeHunk[];
};

export async function loadReviewSignals(
  octokit: Octokit,
  owner: string,
  repo: string,
  headSha: string,
  draft: boolean | undefined,
  draftObservedAt: number,
): Promise<ReviewSignals> {
  const draftSignal: ReviewSignals["draft"] =
    typeof draft === "boolean"
      ? { state: "known", value: draft, headSha, observedAt: draftObservedAt }
      : {
          state: "unknown",
          reason: "GitHub did not supply the PR's draft status.",
          headSha,
          observedAt: draftObservedAt,
        };
  let checks: ReviewSignals["checks"];
  try {
    const [runs, status] = await Promise.all([
      octokit.paginate(octokit.rest.checks.listForRef, {
        owner,
        repo,
        ref: headSha,
        per_page: 100,
      }),
      octokit.rest.repos.getCombinedStatusForRef({ owner, repo, ref: headSha }),
    ]);
    const conclusions = runs.map((run) =>
      run.status !== "completed" ? "pending" : run.conclusion,
    );
    const statusState = status.data.total_count ? status.data.state : "none";
    const failures = new Set([
      "failure",
      "timed_out",
      "cancelled",
      "action_required",
      "stale",
      "startup_failure",
      "error",
    ]);
    const successes = new Set(["success", "neutral", "skipped"]);
    let value: "passed" | "failed" | "pending" | "none";
    if (
      conclusions.some((entry) => entry && failures.has(entry)) ||
      failures.has(statusState)
    )
      value = "failed";
    else if (conclusions.includes("pending") || statusState === "pending")
      value = "pending";
    else if (!runs.length && statusState === "none") value = "none";
    else if (
      conclusions.every((entry) => entry && successes.has(entry)) &&
      (statusState === "success" || statusState === "none")
    )
      value = "passed";
    else throw new Error("Unknown check conclusion");
    checks = { state: "known", value, headSha, observedAt: Date.now() };
  } catch {
    checks = {
      state: "unavailable",
      reason:
        "CI/check status could not be read for the reviewed commit. Check GitHub permissions and inspect CI on GitHub.",
      headSha,
      observedAt: Date.now(),
    };
  }
  return { draft: draftSignal, checks };
}

export async function loadPullRequest(
  octokit: Octokit,
  owner: string,
  repo: string,
  pull_number: number,
  diffTokenBudget = createReviewBudget().diffTokens,
) {
  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number,
  });
  const draftObservedAt = Date.now();
  if (pr.changed_files > 100)
    throw new Error(
      "This PR changes more than 100 files. Split it into smaller PRs before reviewing.",
    );
  if (!pr.head.repo)
    throw new Error("The PR's source repository is no longer available.");
  const files: ChangedFile[] = [];
  const diffs: ReviewFileDiff[] = [];
  const warnings: string[] = [];
  const patches = new Map<string, string | undefined>();
  let remaining = diffTokenBudget;
  // GitHub listFiles returns 100 per page. A second page handles a concurrent increase.
  for (let page = 1; page <= 2; page++) {
    const { data } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number,
      per_page: 100,
      page,
    });
    if (files.length + data.length > 100)
      throw new Error(
        "This PR changes more than 100 files. Split it into smaller PRs before reviewing.",
      );
    for (const f of data) {
      const patch = f.patch;
      patches.set(f.filename, patch);
      const patchTokens = estimateTokens(
        JSON.stringify({
          patch,
          hunks: buildHunks(
            { filename: f.filename, patch },
            `${pr.head.sha}:${pr.base.sha}`,
          ),
        }),
      );
      const lockfile =
        /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/.test(
          f.filename,
        );
      const omitted = !patch
        ? "GitHub supplied no text patch"
        : lockfile
          ? "lockfile"
          : patchTokens > remaining
            ? "diff token budget"
            : undefined;
      diffs.push({
        filename: f.filename,
        previousFilename: f.previous_filename,
        status: f.status,
        patch:
          patch && patch.length <= MAX_DISPLAY_PATCH_CHARS ? patch : undefined,
        omittedReason: omitted,
        coverageGaps: [
          ...(!patch
            ? [
                {
                  kind: "text_patch_unavailable" as const,
                  reason: "GitHub supplied no text patch.",
                },
              ]
            : []),
          ...(patch && omitted
            ? [{ kind: "model_context_omitted" as const, reason: omitted }]
            : []),
          ...(patch && patch.length > MAX_DISPLAY_PATCH_CHARS
            ? [
                {
                  kind: "display_size_excluded" as const,
                  reason:
                    "The text patch exceeds the saved display-size limit.",
                },
              ]
            : []),
        ],
        changedLineRanges: patch ? changedLineRanges(patch) : undefined,
        hunks: buildHunks(
          {
            filename: f.filename,
            patch:
              patch && patch.length <= MAX_DISPLAY_PATCH_CHARS
                ? patch
                : undefined,
          },
          `${pr.head.sha}:${pr.base.sha}`,
        ),
        headBlobSha: f.status === "removed" ? undefined : (f.sha ?? undefined),
      });
      files.push({
        filename: f.filename,
        hunks: diffs.at(-1)?.hunks,
        headBlobSha: f.status === "removed" ? undefined : (f.sha ?? undefined),
        previous_filename: f.previous_filename,
        status: f.status,
        patch: omitted ? undefined : patch,
        anchors: patch
          ? {
              LEFT: [...changedLineAnchors(patch, "LEFT").keys()],
              RIGHT: [...changedLineAnchors(patch, "RIGHT").keys()],
            }
          : undefined,
      });
      if (omitted) warnings.push(`Diff omitted: ${f.filename} (${omitted}).`);
      else remaining -= patchTokens;
    }
    if (data.length < 100) break;
  }
  const { data: latest } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number,
  });
  if (latest.head.sha !== pr.head.sha || latest.base.sha !== pr.base.sha)
    throw new Error(
      "The PR changed while its diff was loading. Run the review again.",
    );
  let diffLeftSha: string | undefined;
  try {
    const { data: comparison } =
      await octokit.rest.repos.compareCommitsWithBasehead({
        owner,
        repo,
        basehead: `${pr.base.sha}...${pr.head.repo.owner.login.toLowerCase() === owner.toLowerCase() ? "" : `${pr.head.repo.owner.login}:`}${pr.head.sha}`,
        per_page: 1,
      });
    const comparisonFiles = comparison.files ?? [];
    const sameFiles =
      comparisonFiles.length === files.length &&
      files.every((file) => {
        const compared = comparisonFiles.find(
          (entry) => entry.filename === file.filename,
        );
        return (
          compared &&
          compared.status === file.status &&
          compared.previous_filename === file.previous_filename &&
          compared.patch === patches.get(file.filename) &&
          (file.anchors === undefined ||
            (JSON.stringify([
              ...changedLineAnchors(compared.patch ?? "", "LEFT").keys(),
            ]) === JSON.stringify(file.anchors.LEFT) &&
              JSON.stringify([
                ...changedLineAnchors(compared.patch ?? "", "RIGHT").keys(),
              ]) === JSON.stringify(file.anchors.RIGHT)))
        );
      });
    if (!sameFiles) throw new Error("Comparison mismatch");
    const verifiedLeftSha = comparison.merge_base_commit.sha;
    const { data: leftTree } = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: verifiedLeftSha,
      recursive: "true",
    });
    if (leftTree.truncated)
      throw new Error("Comparison ancestor tree truncated");
    diffLeftSha = verifiedLeftSha;
    for (const file of files) {
      file.leftBlobSha = leftTree.tree.find(
        (entry) =>
          entry.type === "blob" &&
          entry.path === (file.previous_filename ?? file.filename),
      )?.sha;
      const saved = diffs.find((entry) => entry.filename === file.filename);
      if (saved) saved.leftBlobSha = file.leftBlobSha;
    }
  } catch {
    warnings.push(
      "The comparison ancestor for LEFT-side code could not be established. New LEFT-side references are unavailable; the saved diff remains visible.",
    );
  }
  const { data: tree } = await octokit.rest.git.getTree({
    owner: pr.head.repo.owner.login,
    repo: pr.head.repo.name,
    tree_sha: pr.head.sha,
    recursive: "true",
  });
  const allPaths = tree.tree
    .filter((f) => f.type === "blob" && f.mode !== "120000" && f.path && f.sha)
    .map((f) => ({ path: f.path!, sha: f.sha!, size: f.size ?? 0 }));
  const changedPaths = new Set(files.map((f) => f.filename));
  allPaths.sort(
    (a, b) =>
      Number(changedPaths.has(b.path)) - Number(changedPaths.has(a.path)),
  );
  let pathChars = 0;
  const paths = allPaths.filter((f) => {
    pathChars += f.path.length + 100;
    return pathChars <= 350_000;
  });
  if (paths.length < allPaths.length)
    warnings.push(
      "Repository file discovery reached its size limit; some related files are unavailable to this review.",
    );
  if (tree.truncated)
    warnings.push(
      "GitHub truncated the repository tree; some related files could not be discovered.",
    );
  const signals = await loadReviewSignals(
    octokit,
    owner,
    repo,
    pr.head.sha,
    pr.draft,
    draftObservedAt,
  );
  return {
    signals,
    title: pr.title,
    body: (pr.body ?? "").slice(0, 8000),
    headSha: pr.head.sha,
    baseSha: pr.base.sha,
    baseTipSha: pr.base.sha,
    ...(diffLeftSha ? { diffLeftSha } : {}),
    sourceOwner: pr.head.repo.owner.login,
    sourceRepo: pr.head.repo.name,
    changedFiles: pr.changed_files,
    files,
    diffs,
    paths,
    inventoryComplete:
      !tree.truncated &&
      paths.length === allPaths.length &&
      !tree.tree.some(
        (entry) => entry.type === "blob" && entry.mode === "120000",
      ),
    warnings,
  };
}

export function createRepositoryReader(
  octokit: Octokit,
  snapshot: Omit<Awaited<ReturnType<typeof loadPullRequest>>, "diffs">,
  beforeRead: () => Promise<void>,
  repositoryTokenBudget = createReviewBudget().repositoryTokens,
) {
  const evidence: EvidenceLines = new Map();
  const filesRead = new Set<string>();
  const warnings = new Set(snapshot.warnings);
  const contentCache = new Map<string, Promise<string | null>>();
  let reads = 0,
    usedTokens = 0;

  for (const file of snapshot.files) {
    if (!file.patch) continue;
    // Quoted evidence comes from the head revision only. Deleted anchors may
    // still cite other head files to explain a regression caused by removal.
    evidence.set(file.filename, changedLineAnchors(file.patch, "RIGHT"));
  }

  async function content(path: string) {
    const entry = snapshot.paths.find((f) => f.path === path);
    if (!entry) return null;
    if (entry.size > MAX_FILE_BYTES) {
      warnings.add(`File not read: ${path} exceeds the file-size limit.`);
      return null;
    }
    const existing = contentCache.get(path);
    if (existing) return existing;
    if (++reads > MAX_READS) {
      warnings.add("Repository read limit reached; investigation is partial.");
      return null;
    }
    const pending = (async () => {
      await beforeRead();
      const { data } = await octokit.rest.git.getBlob({
        owner: snapshot.sourceOwner,
        repo: snapshot.sourceRepo,
        file_sha: entry.sha,
      });
      if (data.encoding !== "base64" || (data.size ?? 0) > MAX_FILE_BYTES)
        return null;
      const buffer = Buffer.from(data.content, "base64");
      if (buffer.includes(0)) return null;
      return buffer.toString("utf8");
    })();
    contentCache.set(path, pending);
    return pending;
  }

  function deliverLine(path: string, line: number, text: string) {
    const quoted = evidence.get(path) ?? new Map<number, string>();
    const previous = quoted.get(line);
    if (previous !== undefined && previous.startsWith(text)) return "duplicate";
    const tokens = estimateTokens(JSON.stringify(`${line}: ${text}\n`));
    if (usedTokens + tokens > repositoryTokenBudget) {
      warnings.add(
        "Repository token budget reached; investigation is partial.",
      );
      return "exhausted";
    }
    usedTokens += tokens;
    quoted.set(line, text);
    evidence.set(path, quoted);
    filesRead.add(path);
    return "delivered";
  }

  async function readFile(
    path: string,
    startLine = 1,
    endLine = startLine + 159,
  ) {
    await beforeRead();
    if (endLine < startLine)
      return { error: "End line must be at or after the start line." };
    const text = await content(path);
    if (text === null)
      return {
        error: "File is unavailable, binary, or exceeds review limits.",
      };
    const lines = text.split("\n");
    const start = Math.max(1, startLine);
    const end = Math.min(lines.length, endLine, start + 199);
    if (start > lines.length)
      return { error: "Start line is past the end of this file." };
    const output: string[] = [];
    let lastLine = start - 1;
    let alreadyRead = 0;
    let partial = false;
    for (let i = start - 1; i < end; i++) {
      const delivered = deliverLine(path, i + 1, lines[i]);
      if (delivered === "exhausted") {
        partial = true;
        break;
      }
      lastLine = i + 1;
      if (delivered === "duplicate") alreadyRead++;
      else output.push(`${i + 1}: ${lines[i]}`);
    }
    return {
      path,
      totalLines: lines.length,
      startLine: start,
      content: output.join("\n"),
      lastLine,
      ...(alreadyRead ? { alreadyRead } : {}),
      ...(partial
        ? { partial: true, error: "Repository token budget reached." }
        : {}),
    };
  }

  async function searchText(query: string, pathPrefix: string) {
    await beforeRead();
    const candidates = snapshot.paths.filter(
      (f) => f.path.startsWith(pathPrefix) && f.size <= MAX_FILE_BYTES,
    );
    if (candidates.length > 25)
      warnings.add(
        `Search for ${JSON.stringify(query)} examined only the first 25 files under ${pathPrefix || "/"}.`,
      );
    const matches: { path: string; line: number; text: string }[] = [];
    let alreadyRead = 0;
    for (const file of candidates.slice(0, 25)) {
      const text = await content(file.path);
      if (text === null) continue;
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(query)) {
          const text = lines[i].slice(0, 500);
          const delivered = deliverLine(file.path, i + 1, text);
          if (delivered === "exhausted")
            return {
              matches,
              partial: true,
              alreadyRead,
              error: "Repository token budget reached.",
            };
          if (delivered === "duplicate") alreadyRead++;
          else
            matches.push({
              path: file.path,
              line: i + 1,
              text,
            });
          if (matches.length >= 20)
            return {
              matches,
              partial: true,
              ...(alreadyRead ? { alreadyRead } : {}),
            };
        }
      }
    }
    return {
      matches,
      partial: candidates.length > 25,
      ...(alreadyRead ? { alreadyRead } : {}),
    };
  }

  return { evidence, filesRead, warnings, readFile, searchText };
}
