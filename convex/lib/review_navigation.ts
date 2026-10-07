import { z } from "zod";

export const hotspotDraftSchema = z.object({
  kind: z.enum(["possible_issue", "human_judgment"]),
  title: z.string().min(1).max(180),
  reason: z.string().min(1).max(1500),
  references: z
    .array(
      z.object({
        path: z.string().min(1).max(500),
        line: z.number().int().positive(),
        side: z.enum(["LEFT", "RIGHT"]),
      }),
    )
    .min(1)
    .max(6),
});
export const codeReferenceSchema = z.object({
  path: z.string().min(1).max(500),
  sourcePath: z.string().min(1).max(500),
  line: z.number().int().positive(),
  side: z.enum(["LEFT", "RIGHT"]),
  commitSha: z.string().min(1),
  blobSha: z.string().min(1).optional(),
});
export const hotspotSchema = hotspotDraftSchema.extend({
  id: z.string().min(1),
  references: z.array(codeReferenceSchema).min(1).max(6),
});
export type Hotspot = z.infer<typeof hotspotSchema>;
export type CodeReference = z.infer<typeof codeReferenceSchema>;
export type FileCoverageGap = {
  kind:
    | "text_patch_unavailable"
    | "model_context_omitted"
    | "display_size_excluded";
  reason: string;
};
export type NavigationFile = {
  filename: string;
  previousFilename?: string;
  status: string;
  patch?: string;
  headBlobSha?: string;
  leftBlobSha?: string;
  coverageGaps?: FileCoverageGap[];
  omittedReason?: string;
  changedLineRanges?: {
    LEFT: { start: number; end: number }[];
    RIGHT: { start: number; end: number }[];
  };
};
export type ReferenceFile = {
  filename: string;
  previous_filename?: string;
  anchors?: { LEFT: number[]; RIGHT: number[] };
  headBlobSha?: string;
  leftBlobSha?: string;
};

export function validateHotspots(
  drafts: unknown[],
  files: ReferenceFile[],
  snapshot: { headSha: string; diffLeftSha?: string },
  runId: string,
) {
  let rejected = 0;
  const hotspots = drafts.flatMap((draft, index): Hotspot[] => {
    const parsed = hotspotDraftSchema.safeParse(draft);
    if (!parsed.success) {
      rejected++;
      return [];
    }
    const references = parsed.data.references.flatMap(
      (reference): CodeReference[] => {
        const file = files.find((entry) => entry.filename === reference.path);
        const commitSha =
          reference.side === "RIGHT" ? snapshot.headSha : snapshot.diffLeftSha;
        const blobSha =
          reference.side === "RIGHT" ? file?.headBlobSha : file?.leftBlobSha;
        if (
          !blobSha ||
          !file?.anchors?.[reference.side].includes(reference.line) ||
          !commitSha
        )
          return [];
        return [
          {
            ...reference,
            commitSha,
            sourcePath:
              reference.side === "LEFT"
                ? (file.previous_filename ?? reference.path)
                : reference.path,
            blobSha,
          },
        ];
      },
    );
    if (references.length !== parsed.data.references.length) {
      rejected++;
      return [];
    }
    return [{ ...parsed.data, id: `${runId}:hotspot:${index}`, references }];
  });
  return { hotspots, rejected };
}

export function fileCoverageGaps(file: NavigationFile): FileCoverageGap[] {
  if (file.coverageGaps) return file.coverageGaps;
  const gaps: FileCoverageGap[] = [];
  if (file.omittedReason)
    gaps.push({
      kind:
        file.omittedReason === "GitHub supplied no text patch"
          ? "text_patch_unavailable"
          : "model_context_omitted",
      reason: file.omittedReason,
    });
  if (!file.patch && !gaps.some((gap) => gap.kind === "text_patch_unavailable"))
    gaps.push({
      kind: "text_patch_unavailable",
      reason:
        "No saved text patch is available. This review does not record why.",
    });
  return gaps;
}

export function changedLineAnchors(patch: string, side: "LEFT" | "RIGHT") {
  const lines = new Map<number, string>();
  let left = 0,
    right = 0,
    inHunk = false;
  for (const row of patch.split("\n")) {
    const hunk = row.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      left = Number(hunk[1]);
      right = Number(hunk[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (row.startsWith("+")) {
      if (side === "RIGHT") lines.set(right, row.slice(1));
      right++;
    } else if (row.startsWith("-")) {
      if (side === "LEFT") lines.set(left, row.slice(1));
      left++;
    } else if (row.startsWith(" ")) {
      left++;
      right++;
    }
  }
  return lines;
}

export function changedLineRanges(patch: string) {
  function ranges(side: "LEFT" | "RIGHT") {
    const output: { start: number; end: number }[] = [];
    for (const line of changedLineAnchors(patch, side).keys()) {
      const last = output.at(-1);
      if (last && last.end + 1 === line) last.end = line;
      else output.push({ start: line, end: line });
    }
    return output;
  }
  return { LEFT: ranges("LEFT"), RIGHT: ranges("RIGHT") };
}

export function containsChangedLine(
  file: NavigationFile,
  side: "LEFT" | "RIGHT",
  line: number,
) {
  if (file.changedLineRanges)
    return file.changedLineRanges[side].some(
      (range) => line >= range.start && line <= range.end,
    );
  return file.patch ? changedLineAnchors(file.patch, side).has(line) : false;
}

export const changeHunkSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  ordinal: z.number().int().nonnegative(),
  leftStart: z.number().int().nonnegative(),
  leftLines: z.number().int().nonnegative(),
  rightStart: z.number().int().nonnegative(),
  rightLines: z.number().int().nonnegative(),
  heading: z.string().max(500),
});
export type ChangeHunk = z.infer<typeof changeHunkSchema>;
export const changeGroupDraftSchema = z.object({
  title: z.string().min(1).max(180),
  purpose: z.string().min(1).max(1000),
  hunkIds: z.array(z.string().min(1).max(1500)).min(1).max(100),
});
export const changeGroupSchema = changeGroupDraftSchema.extend({
  id: z.string().min(1),
});
export type ChangeGroup = z.infer<typeof changeGroupSchema>;

export function buildHunks(
  file: Pick<NavigationFile, "filename" | "patch">,
  snapshotId: string,
): ChangeHunk[] {
  if (!file.patch) return [];
  const hunks: ChangeHunk[] = [];
  for (const row of file.patch.split("\n")) {
    const header = row.match(
      /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/,
    );
    if (!header) continue;
    const ordinal = hunks.length;
    hunks.push({
      id: `${snapshotId}:hunk:${encodeURIComponent(file.filename)}:${ordinal}`,
      path: file.filename,
      ordinal,
      leftStart: Number(header[1]),
      leftLines: Number(header[2] ?? 1),
      rightStart: Number(header[3]),
      rightLines: Number(header[4] ?? 1),
      heading: header[5].trim().slice(0, 500),
    });
  }
  return hunks;
}

export function savedHunks(
  files: (NavigationFile & { hunks?: ChangeHunk[] })[],
  legacySnapshotId: string,
) {
  return files.flatMap(
    (file) => file.hunks ?? buildHunks(file, legacySnapshotId),
  );
}

export function validateChangeGroups(
  drafts: unknown[],
  hunks: ChangeHunk[],
  runId: string,
) {
  const available = new Set(hunks.map((hunk) => hunk.id));
  let rejected = 0;
  const groups = drafts.flatMap((draft, index): ChangeGroup[] => {
    const parsed = changeGroupDraftSchema.safeParse(draft);
    if (
      !parsed.success ||
      parsed.data.hunkIds.some((id) => !available.has(id))
    ) {
      rejected++;
      return [];
    }
    return [
      {
        ...parsed.data,
        id: `${runId}:group:${index}`,
        hunkIds: [...new Set(parsed.data.hunkIds)],
      },
    ];
  });
  return { groups, rejected };
}

export function ungroupedHunks(hunks: ChangeHunk[], groups: ChangeGroup[]) {
  const grouped = new Set(groups.flatMap((group) => group.hunkIds));
  return hunks.filter((hunk) => !grouped.has(hunk.id));
}
