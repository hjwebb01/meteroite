import { z } from "zod";
import {
  changedLineAnchors,
  hotspotDraftSchema,
  changeGroupDraftSchema,
  type ChangeHunk,
} from "../../../../convex/lib/review_navigation";
import { assessmentResponseSchema } from "../../../../convex/lib/review_assessment";
import { FINDING_CATEGORIES } from "../../../../convex/lib/review_fields";

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
    !match ||
    match[2] === "." ||
    match[2] === ".."
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

const MAX_FINDINGS = 20;

// A missing or unrecognised label only drops the label, never the finding.
const categorySchema = z
  .enum(FINDING_CATEGORIES)
  .nullish()
  .catch(undefined)
  .transform((value) => value ?? undefined)
  .optional();
const confidenceSchema = z
  .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
  .nullish()
  .catch(undefined)
  .transform((value) => value ?? undefined)
  .optional();

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
  category: categorySchema,
  confidence: confidenceSchema,
});

// The response shapes carry no length or count bounds, so one hotspot or
// finding that breaks a bound is rejected on its own by validateHotspots or
// validateFindings instead of failing the whole review.
const side = z.enum(["LEFT", "RIGHT"]);
const hotspotResponseSchema = z.object({
  kind: hotspotDraftSchema.shape.kind,
  title: z.string(),
  reason: z.string(),
  references: z.array(z.object({ path: z.string(), line: z.number(), side })),
});
const findingResponseSchema = z.object({
  severity: findingSchema.shape.severity,
  title: z.string(),
  path: z.string(),
  line: z.number(),
  side,
  explanation: z.string(),
  suggestion: z.string(),
  evidence: z.array(
    z.object({ path: z.string(), line: z.number(), quote: z.string() }),
  ),
  previousFindingId: z.string().nullable(),
  category: z.string().nullable(),
  confidence: z.number().nullable(),
});

export const reviewOutputSchema = z.object({
  assessment: assessmentResponseSchema.nullable().catch(null),
  hotspots: z.array(hotspotResponseSchema),
  changeGroups: z.array(changeGroupDraftSchema).max(20).catch([]),
  summary: z.string().min(1).max(3000),
  findings: z.array(findingResponseSchema),
  limitations: z.array(z.string()),
});

export type ReviewOutput = z.infer<typeof reviewOutputSchema>;
export type FindingDraft = z.infer<typeof findingSchema>;
export type EvidenceLines = Map<string, Map<number, string>>;
export type ChangedFile = {
  filename: string;
  previous_filename?: string;
  status: string;
  patch?: string;
  /** Which review part's model context carries this patch. */
  part?: number;
  anchors?: { LEFT: number[]; RIGHT: number[] };
  hunks?: ChangeHunk[];
  headBlobSha?: string;
  leftBlobSha?: string;
};

export function validateFindings(
  drafts: unknown[],
  files: ChangedFile[],
  evidence: EvidenceLines,
  previous: { id: string; path: string }[],
  runId: string,
) {
  let rejected = 0;
  const seen = new Set<string>();
  const findings = drafts.flatMap((input, index) => {
    const parsed = findingSchema.safeParse(input);
    if (!parsed.success) {
      rejected++;
      return [];
    }
    const draft = parsed.data;
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
  return {
    findings: findings.slice(0, MAX_FINDINGS),
    rejected: rejected + Math.max(0, findings.length - MAX_FINDINGS),
  };
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
