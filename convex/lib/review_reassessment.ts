import { z } from "zod";
import type {
  CodeReference,
  Hotspot,
  ChangeGroup,
  ChangeHunk,
  NavigationFile,
  ReferenceFile,
} from "./review_navigation";

export const reassessmentSchema = z.object({
  sourceReviewId: z.string().min(1),
  sourceHeadSha: z.string().optional(),
  sourceBaseSha: z.string().optional(),
  headSha: z.string().min(1),
  comparedAt: z.number(),
  contexts: z.array(
    z.object({
      kind: z.enum(["finding", "hotspot", "group"]),
      sourceId: z.string().min(1),
      state: z.enum(["unchanged", "changed", "ambiguous"]),
      reason: z.string().min(1),
      currentPaths: z.array(z.string()),
      currentId: z.string().optional(),
    }),
  ),
  absentFindingIds: z.array(z.string()),
});
export type ReassessmentContext = z.infer<typeof reassessmentSchema>;
type Finding = {
  id: string;
  path: string;
  anchorPath?: string;
  side: "LEFT" | "RIGHT";
  evidence: { path: string; blobSha?: string; commitSha?: string }[];
  previousFindingId?: string | null;
};
type SavedFile = NavigationFile & { hunks?: ChangeHunk[] };
type SupportingReference = Pick<
  CodeReference,
  "path" | "sourcePath" | "side"
> & { commitSha?: string; blobSha?: string };
type PriorReview = {
  _id: string;
  headSha?: string;
  baseSha?: string;
  diffLeftSha?: string;
  result?: {
    findings: Finding[];
    hotspots?: Hotspot[];
    changeGroups?: ChangeGroup[];
  };
};

export function compareReviewSnapshots({
  previous,
  previousFiles,
  current,
  findings,
  comparedAt,
}: {
  previous: PriorReview;
  previousFiles: SavedFile[];
  current: {
    headSha: string;
    diffLeftSha?: string;
    files: ReferenceFile[];
    paths: { path: string; sha: string }[];
    inventoryComplete: boolean;
  };
  findings: Finding[];
  comparedAt: number;
}): ReassessmentContext {
  function inspect(ref: SupportingReference) {
    const renames = current.files.filter(
      (file) => file.previous_filename === ref.sourcePath,
    );
    const original = current.paths.find(
      (entry) => entry.path === ref.sourcePath,
    );
    if (!original && renames.length > 1)
      return {
        state: "ambiguous" as const,
        path: ref.sourcePath,
        available: false,
      };
    const renamed = original ? undefined : renames[0];
    const path = renamed?.filename ?? ref.sourcePath;
    const available =
      current.paths.some((entry) => entry.path === path) ||
      current.files.some((file) => file.filename === path);
    if (!ref.blobSha || !ref.commitSha)
      return { state: "ambiguous" as const, path, available };
    const commit = ref.side === "RIGHT" ? current.headSha : current.diffLeftSha;
    if (commit === ref.commitSha)
      return { state: "unchanged" as const, path, available: true };
    const blob =
      ref.side === "RIGHT"
        ? (current.paths.find((entry) => entry.path === path)?.sha ??
          current.files.find((file) => file.filename === path)?.headBlobSha)
        : current.files.find(
            (file) =>
              (file.previous_filename ?? file.filename) === ref.sourcePath,
          )?.leftBlobSha;
    if (blob)
      return {
        state:
          blob === ref.blobSha ? ("unchanged" as const) : ("changed" as const),
        path,
        available,
      };
    return {
      state:
        ref.side === "RIGHT" && current.inventoryComplete
          ? ("changed" as const)
          : ("ambiguous" as const),
      path,
      available,
    };
  }
  function compare(
    kind: "finding" | "hotspot" | "group",
    sourceId: string,
    refs: SupportingReference[],
    currentId?: string,
    missingSupport = false,
  ) {
    const observations = refs.map(inspect);
    const state: "unchanged" | "changed" | "ambiguous" = observations.some(
      (entry) => entry.state === "changed",
    )
      ? "changed"
      : missingSupport ||
          !observations.length ||
          observations.some((entry) => entry.state === "ambiguous")
        ? "ambiguous"
        : "unchanged";
    const reasons = {
      changed:
        "Recorded supporting code changed or was removed. Reassess the earlier interpretation against this snapshot.",
      ambiguous:
        "Supporting blob provenance is missing or cannot be matched confidently. Reassessment is required.",
      unchanged:
        "Recorded supporting blobs are unchanged. Earlier discussion and conclusions remain attributed to their original snapshot.",
    };
    return {
      kind,
      sourceId,
      state,
      reason: reasons[state],
      currentPaths: [
        ...new Set(
          observations
            .filter((entry) => entry.available)
            .map((entry) => entry.path),
        ),
      ],
      ...(currentId ? { currentId } : {}),
    };
  }
  function fileReference(
    file: SavedFile | undefined,
    side: "LEFT" | "RIGHT",
    fallbackPath: string,
  ): SupportingReference {
    return {
      path: fallbackPath,
      sourcePath:
        side === "LEFT"
          ? (file?.previousFilename ?? fallbackPath)
          : fallbackPath,
      side,
      commitSha: side === "LEFT" ? previous.diffLeftSha : previous.headSha,
      blobSha: side === "LEFT" ? file?.leftBlobSha : file?.headBlobSha,
    };
  }
  const contexts: ReassessmentContext["contexts"] = [];
  for (const finding of previous.result?.findings ?? []) {
    const file = previousFiles.find((entry) => entry.filename === finding.path);
    const refs = [
      fileReference(file, finding.side, finding.path),
      ...finding.evidence.map((evidence): SupportingReference => ({
        path: evidence.path,
        sourcePath: evidence.path,
        side: "RIGHT",
        commitSha: evidence.commitSha ?? previous.headSha,
        blobSha:
          evidence.blobSha ??
          previousFiles.find((entry) => entry.filename === evidence.path)
            ?.headBlobSha,
      })),
    ];
    contexts.push(
      compare(
        "finding",
        finding.id,
        refs,
        findings.find((entry) => entry.previousFindingId === finding.id)?.id,
      ),
    );
  }
  for (const hotspot of previous.result?.hotspots ?? [])
    contexts.push(compare("hotspot", hotspot.id, hotspot.references));
  for (const group of previous.result?.changeGroups ?? []) {
    const paths = new Set(
      group.hunkIds.flatMap((id) =>
        previousFiles.flatMap(
          (file) =>
            file.hunks
              ?.filter((hunk) => hunk.id === id)
              .map((hunk) => hunk.path) ?? [],
        ),
      ),
    );
    const refs = [...paths].flatMap((path) => {
      const file = previousFiles.find((entry) => entry.filename === path);
      return [
        ...(file?.status !== "added"
          ? [fileReference(file, "LEFT", path)]
          : []),
        ...(file?.status !== "removed"
          ? [fileReference(file, "RIGHT", path)]
          : []),
      ];
    });
    const missingSupport = group.hunkIds.some(
      (id) =>
        !previousFiles.some((file) =>
          file.hunks?.some((hunk) => hunk.id === id),
        ),
    );
    contexts.push(compare("group", group.id, refs, undefined, missingSupport));
  }
  const linked = new Set(findings.map((finding) => finding.previousFindingId));
  return reassessmentSchema.parse({
    sourceReviewId: previous._id,
    sourceHeadSha: previous.headSha,
    sourceBaseSha: previous.baseSha,
    headSha: current.headSha,
    comparedAt,
    contexts,
    absentFindingIds: (previous.result?.findings ?? [])
      .filter((finding) => !linked.has(finding.id))
      .map((finding) => finding.id),
  });
}
