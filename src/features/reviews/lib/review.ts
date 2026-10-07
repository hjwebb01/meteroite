import { z } from "zod";
import {
  changedLineAnchors,
  hotspotDraftSchema,
  changeGroupDraftSchema,
  type ChangeHunk,
} from "../../../../convex/lib/review_navigation";
import { assessmentResponseSchema } from "../../../../convex/lib/review_assessment";

export function parsePullRequestUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a GitHub pull request URL.");
  }
  const match = url.pathname.match(
    /^\/([A-Za-z0-9-]{1,100})\/([A-Za-z0-9_.-]{1,100})\/pull\/(\d+)(?:\/(?:files|commits|checks))?\/?$/,
  );
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    !match
  )
    throw new Error("Enter a URL like https://github.com/owner/repo/pull/123.");
  const pullNumber = Number(match[3]);
  if (!Number.isSafeInteger(pullNumber) || pullNumber < 1)
    throw new Error("The pull request number must be a positive integer.");
  const repoOwner = match[1].toLowerCase();
  const repoName = match[2].toLowerCase();
  return {
    repoOwner,
    repoName,
    pullNumber,
    url: `https://github.com/${repoOwner}/${repoName}/pull/${pullNumber}`,
  };
}

export const findingSchema = z.object({
  severity: z.enum(["high", "medium", "low"]),
  title: z.string().min(1).max(180),
  path: z.string().min(1).max(500),
  line: z.number().int().positive(),
  side: z.enum(["LEFT", "RIGHT"]),
  explanation: z.string().min(1).max(3000),
  suggestion: z.string().min(1).max(2000),
  evidence: z
    .array(
      z.object({
        path: z.string().max(500),
        line: z.number().int().positive(),
        quote: z.string().min(8).max(500),
      }),
    )
    .min(1)
    .max(4),
  previousFindingId: z.string().nullable(),
});

export const reviewOutputSchema = z.object({
  assessment: assessmentResponseSchema.nullable().catch(null),
  hotspots: z.array(hotspotDraftSchema).max(12),
  changeGroups: z.array(changeGroupDraftSchema).max(20).catch([]),
  summary: z.string().min(1).max(3000),
  findings: z.array(findingSchema).max(20),
  limitations: z.array(z.string().max(500)).max(10),
});

export type FindingDraft = z.infer<typeof findingSchema>;
export type EvidenceLines = Map<string, Map<number, string>>;
export type ChangedFile = {
  filename: string;
  previous_filename?: string;
  status: string;
  patch?: string;
  anchors?: { LEFT: number[]; RIGHT: number[] };
  hunks?: ChangeHunk[];
  headBlobSha?: string;
  leftBlobSha?: string;
};

export function validateFindings(
  drafts: FindingDraft[],
  files: ChangedFile[],
  evidence: EvidenceLines,
  previous: { id: string; path: string }[],
  runId: string,
) {
  let rejected = 0;
  const seen = new Set<string>();
  const findings = drafts.flatMap((draft, index) => {
    const file = files.find((f) => f.filename === draft.path);
    const anchor = new Set(
      file?.anchors?.[draft.side] ??
        (file?.patch
          ? [...changedLineAnchors(file.patch, draft.side).keys()]
          : []),
    );
    const supported = draft.evidence.every((e) => {
      const line = evidence.get(e.path)?.get(e.line);
      return (
        line !== undefined &&
        e.quote.trim().length >= 8 &&
        line.includes(e.quote.trim())
      );
    });
    const key = `${draft.path}:${draft.side}:${draft.line}:${draft.title.toLowerCase()}`;
    if (!anchor.has(draft.line) || !supported || seen.has(key)) {
      rejected++;
      return [];
    }
    seen.add(key);
    return [
      {
        ...draft,
        anchorPath:
          draft.side === "LEFT"
            ? (file?.previous_filename ?? draft.path)
            : draft.path,
        id: `${runId}:${index}`,
        previousFindingId: previous.some(
          (p) =>
            p.id === draft.previousFindingId &&
            (p.path === draft.path || p.path === file?.previous_filename),
        )
          ? draft.previousFindingId
          : null,
      },
    ];
  });
  return { findings, rejected };
}

export function fileAtCommitUrl(
  owner: string,
  repo: string,
  sha: string,
  path: string,
  line: number,
) {
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/blob/${encodeURIComponent(sha)}/${path.split("/").map(encodeURIComponent).join("/")}#L${line}`;
}

export { changedLineAnchors } from "../../../../convex/lib/review_navigation";
