import { clerkClient } from "@clerk/nextjs/server";
import { Octokit } from "octokit";
import type { Doc } from "../../../../convex/_generated/dataModel";
import { ApplicationBlockedError } from "../../../../convex/lib/review_application";
import { canonicalProposal, proposalDigest } from "./finding-proposal";
export async function githubApplicationClient(ownerId: string) {
  const client = await clerkClient();
  const grants = await client.users.getUserOauthAccessToken(ownerId, "github");
  const grant = grants.data[0];
  if (!grant)
    throw new ApplicationBlockedError(
      "disconnected",
      "GitHub is disconnected. Reconnect your GitHub account before applying.",
    );
  const octokit = new Octokit({ auth: grant.token });
  // Each request gets its own 20-second limit; one shared signal would end
  // a long application partway through.
  octokit.hook.wrap("request", (request, options) =>
    request({
      ...options,
      request: { ...options.request, signal: AbortSignal.timeout(20000) },
    }),
  );
  return { octokit, scopes: grant.scopes ?? [] };
}
export function applicationMarker(applicationId: string, digest: string) {
  return `Meteroite-Application: ${applicationId}\nMeteroite-Proposal: ${digest}`;
}

function accessFailure(error: unknown, target: string): never {
  const response = error as {
    status?: number;
    response?: { headers?: Record<string, string> };
  } | null;
  const status = response?.status;
  if (
    status === 403 &&
    (response?.response?.headers?.["x-ratelimit-remaining"] === "0" ||
      response?.response?.headers?.["retry-after"])
  )
    throw error;
  if (status === 401)
    throw new ApplicationBlockedError(
      "disconnected",
      "GitHub credentials are no longer valid. Reconnect GitHub; the proposal remains saved.",
    );
  if (status === 403 || status === 404)
    throw new ApplicationBlockedError(
      "permission",
      `GitHub access to ${target} is unavailable. Check repository access and your GitHub connection; request source-repository write access before applying. The proposal remains saved.`,
    );
  throw error;
}

// Only explicit rejection responses can resolve a write as unsuccessful.
// Transport failures, internal errors, and partial commit responses stay uncertain.
export class ApplicationWriteRejectedError extends ApplicationBlockedError {}
function writeRejection(error: unknown) {
  const response = error as {
    name?: string;
    data?: { createCommitOnBranch?: { commit?: unknown } | null } | null;
    errors?: Array<{
      type?: string;
      path?: unknown[];
      extensions?: { code?: string; problems?: unknown[] };
      message: string;
    }>;
  } | null;
  if (
    response?.name !== "GraphqlResponseError" ||
    response.data?.createCommitOnBranch?.commit ||
    !response.errors?.length
  )
    return null;
  const codes = response.errors.map(
    (item) =>
      item.type ??
      item.extensions?.code ??
      (!response.data && !item.path && item.extensions?.problems?.length
        ? "GRAPHQL_VALIDATION_FAILED"
        : undefined),
  );
  if (
    !codes.every(
      (code) =>
        code &&
        [
          "STALE_DATA",
          "FORBIDDEN",
          "NOT_FOUND",
          "UNPROCESSABLE",
          "GRAPHQL_VALIDATION_FAILED",
        ].includes(code),
    )
  )
    return null;
  if (codes.includes("STALE_DATA"))
    return new ApplicationWriteRejectedError(
      "stale",
      "The source branch advanced. Start a new review and investigation. No newer work was overwritten.",
    );
  if (codes.includes("FORBIDDEN") || codes.includes("NOT_FOUND"))
    return new ApplicationWriteRejectedError(
      "permission",
      "GitHub rejected the write. Check source-repository write access and branch protection rules. The proposal remains saved.",
    );
  return new ApplicationWriteRejectedError(
    "invalid_proposal",
    "GitHub rejected the proposal input. Start a new review and investigation; the saved patch remains available.",
  );
}
export async function inspectApplicationTarget(
  octokit: Octokit,
  scopes: string[],
  proposal: Doc<"reviewProposals">,
  review: Doc<"reviews">,
) {
  const { data: pr } = await octokit.rest.pulls
    .get({
      owner: review.repoOwner,
      repo: review.repoName,
      pull_number: review.pullNumber,
    })
    .catch((error: unknown) =>
      accessFailure(error, `${review.repoOwner}/${review.repoName}`),
    );
  if (
    pr.state !== "open" ||
    pr.head.repo?.owner.login.toLowerCase() !==
      proposal.sourceOwner.toLowerCase() ||
    pr.head.repo?.name.toLowerCase() !== proposal.sourceRepo.toLowerCase() ||
    pr.head.ref !== proposal.sourceBranch
  )
    throw new ApplicationBlockedError(
      "stale",
      "The PR source branch changed or is closed. Start a new review and investigation.",
    );
  const { data: repo, headers } = await octokit.rest.repos
    .get({
      owner: proposal.sourceOwner,
      repo: proposal.sourceRepo,
    })
    .catch((error: unknown) =>
      accessFailure(error, `${proposal.sourceOwner}/${proposal.sourceRepo}`),
    );
  const actual = (headers["x-oauth-scopes"] ?? scopes.join(","))
    .split(",")
    .map((s) => s.trim());
  if (
    !actual.includes("repo") &&
    (!actual.includes("public_repo") || repo.private)
  )
    throw new ApplicationBlockedError(
      "scope",
      `Reconnect GitHub with ${repo.private ? "repo" : "public_repo or repo"} write scope. The proposal remains saved.`,
    );
  if (
    proposal.files.some((f) => f.path.startsWith(".github/workflows/")) &&
    !actual.includes("workflow")
  )
    throw new ApplicationBlockedError(
      "scope",
      "Reconnect GitHub with workflow scope to change workflow files. The proposal remains saved.",
    );
  if (!repo.permissions?.push)
    throw new ApplicationBlockedError(
      "permission",
      `Your GitHub account cannot push to ${proposal.sourceOwner}/${proposal.sourceRepo}. Request source-repository write access; fork proposals remain saved.`,
    );
  const { data: ref } = await octokit.rest.git
    .getRef({
      owner: proposal.sourceOwner,
      repo: proposal.sourceRepo,
      ref: `heads/${proposal.sourceBranch}`,
    })
    .catch((error: unknown) =>
      accessFailure(error, `${proposal.sourceOwner}/${proposal.sourceRepo}`),
    );
  return ref.object.sha;
}
export async function reconcileApplication(
  octokit: Octokit,
  application: Doc<"reviewApplications">,
  proposal: Doc<"reviewProposals">,
) {
  const marker = applicationMarker(application._id, proposal.digest);
  for (let page = 1; page <= 2; page++) {
    const { data: commits } = await octokit.rest.repos.listCommits({
      owner: proposal.sourceOwner,
      repo: proposal.sourceRepo,
      sha: proposal.sourceBranch,
      per_page: 100,
      page,
    });
    const found = commits.find((c) => c.commit.message.includes(marker));
    if (found) {
      await verifyAppliedCommit(octokit, proposal, found.sha, marker);
      return { sha: found.sha, url: found.html_url };
    }
    if (
      commits.some((c) => c.sha === proposal.sourceSha) ||
      commits.length < 100
    )
      return null;
  }
  throw new Error(
    "Application result is uncertain beyond the recent branch history. No further write was attempted.",
  );
}
async function verifyAppliedCommit(
  octokit: Octokit,
  proposal: Doc<"reviewProposals">,
  sha: string,
  marker: string,
) {
  const { data: commit } = await octokit.rest.git.getCommit({
    owner: proposal.sourceOwner,
    repo: proposal.sourceRepo,
    commit_sha: sha,
  });
  if (
    commit.parents.length !== 1 ||
    commit.parents[0].sha !== proposal.sourceSha ||
    !commit.message.includes(marker)
  )
    throw new Error("Remote commit provenance could not be verified");
  const { data: tree } = await octokit.rest.git.getTree({
    owner: proposal.sourceOwner,
    repo: proposal.sourceRepo,
    tree_sha: commit.tree.sha,
    recursive: "true",
  });
  if (tree.truncated) throw new Error("Remote commit tree is incomplete");
  const { data: original } = await octokit.rest.git.getTree({
    owner: proposal.sourceOwner,
    repo: proposal.sourceRepo,
    tree_sha: proposal.sourceSha,
    recursive: "true",
  });
  if (original.truncated) throw new Error("Original source tree is incomplete");
  const before = new Map(
    original.tree.filter((f) => f.type !== "tree").map((f) => [f.path, f]),
  );
  const after = new Map(
    tree.tree.filter((f) => f.type !== "tree").map((f) => [f.path, f]),
  );
  const expected = new Set(proposal.files.map((f) => f.path));
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const left = before.get(path),
      right = after.get(path);
    if (
      (left?.sha !== right?.sha || left?.mode !== right?.mode) &&
      !expected.has(path!)
    )
      throw new Error(
        "Remote commit includes changes outside the inspected manifest",
      );
  }
  for (const file of proposal.files) {
    const entry = tree.tree.find((f) => f.path === file.path);
    if (file.replacement === null) {
      if (entry) throw new Error("Remote deletion was not verified");
    } else {
      if (!entry?.sha || entry.mode !== "100644")
        throw new Error("Remote file shape was not verified");
      const { data: blob } = await octokit.rest.git.getBlob({
        owner: proposal.sourceOwner,
        repo: proposal.sourceRepo,
        file_sha: entry.sha,
      });
      if (
        blob.encoding !== "base64" ||
        !Buffer.from(blob.content, "base64").equals(
          Buffer.from(file.replacement),
        )
      )
        throw new Error("Remote file contents were not verified");
    }
  }
}
// Read-only checks, run before the application is marked as writing so a
// failure here is never reported as an uncertain remote write.
export async function validateApplication(
  octokit: Octokit,
  application: Doc<"reviewApplications">,
  proposal: Doc<"reviewProposals">,
) {
  if (
    proposalDigest(proposal.sourceSha, proposal.files) !==
    application.proposalDigest
  )
    throw new ApplicationBlockedError(
      "invalid_proposal",
      "Saved proposal digest could not be verified",
    );
  const checked = await canonicalProposal(
    octokit,
    {
      sourceSha: proposal.sourceSha,
      sourceOwner: proposal.sourceOwner,
      sourceRepo: proposal.sourceRepo,
    },
    {
      rationale: proposal.rationale,
      files: proposal.files.map((f) => ({
        path: f.path,
        replacement: f.replacement,
      })),
      checks: [],
    },
  );
  if (checked.digest !== proposal.digest)
    throw new ApplicationBlockedError(
      "invalid_proposal",
      "Expected source blobs changed or proposal is invalid",
    );
}
export async function commitApplication(
  octokit: Octokit,
  application: Doc<"reviewApplications">,
  proposal: Doc<"reviewProposals">,
) {
  const marker = applicationMarker(application._id, proposal.digest);
  const result = await octokit
    .graphql<{
      createCommitOnBranch: { commit: { oid: string; url: string } };
    }>(
      `mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input:$input) { commit { oid url } } }`,
      {
        input: {
          branch: {
            repositoryNameWithOwner: `${proposal.sourceOwner}/${proposal.sourceRepo}`,
            branchName: proposal.sourceBranch,
          },
          expectedHeadOid: proposal.sourceSha,
          clientMutationId: application._id,
          message: {
            headline: `Fix reviewed finding: ${proposal.findingId}`,
            body: marker,
          },
          fileChanges: {
            additions: proposal.files
              .filter((f) => f.replacement !== null)
              .map((f) => ({
                path: f.path,
                contents: Buffer.from(f.replacement!).toString("base64"),
              })),
            deletions: proposal.files
              .filter((f) => f.replacement === null)
              .map((f) => ({ path: f.path })),
          },
        },
      },
    )
    .catch((error: unknown) => {
      throw writeRejection(error) ?? error;
    });
  const remote = result.createCommitOnBranch.commit;
  await verifyAppliedCommit(octokit, proposal, remote.oid, marker);
  const confirmed = await reconcileApplication(octokit, application, proposal);
  if (!confirmed || confirmed.sha !== remote.oid)
    throw new Error(
      "Commit response received but source-branch membership could not be verified",
    );
  return confirmed;
}
