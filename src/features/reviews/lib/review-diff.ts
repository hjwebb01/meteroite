import {
  processFile,
  type CodeViewDiffItem,
  type DiffLineAnnotation,
  type FileDiffMetadata,
} from "@pierre/diffs";
import type { Doc } from "../../../../convex/_generated/dataModel";

export type ReviewFinding = NonNullable<
  Doc<"reviews">["result"]
>["findings"][number];

import type {
  Hotspot,
  CodeReference,
  ChangeGroup,
  ChangeHunk,
} from "../../../../convex/lib/review_navigation";

export type ReviewAnnotation =
  | { kind: "finding"; finding: ReviewFinding }
  | { kind: "hotspot"; hotspot: Hotspot; reference: CodeReference };
export type ReviewNavigationTarget =
  | ReviewAnnotation
  | { kind: "file"; path: string }
  | { kind: "reference"; reference: CodeReference }
  | { kind: "hunk"; hunk: ChangeHunk }
  | { kind: "group"; group: ChangeGroup; hunk: ChangeHunk };

export function navigationLocation(target: ReviewNavigationTarget) {
  if (target.kind === "finding") return target.finding;
  if (target.kind === "hotspot" || target.kind === "reference")
    return target.reference;
  if (target.kind === "file") return { path: target.path };
  const hunk = target.hunk;
  return {
    path: hunk.path,
    line: Math.max(1, hunk.rightLines > 0 ? hunk.rightStart : hunk.leftStart),
    side: hunk.rightLines > 0 ? ("RIGHT" as const) : ("LEFT" as const),
  };
}

/**
 * The diff side a code reference is annotated on. Only removed lines are
 * "deletions"; a missing side reads as "additions".
 */
export function diffSideOf(side?: "LEFT" | "RIGHT") {
  return side === "LEFT" ? ("deletions" as const) : ("additions" as const);
}

/** Identifies the diff annotation a target renders as; other targets have none. */
export function annotationKey(target: ReviewAnnotation): string;
export function annotationKey(
  target: ReviewNavigationTarget,
): string | undefined;
export function annotationKey(target: ReviewNavigationTarget) {
  if (target.kind === "finding") return `finding:${target.finding.id}`;
  if (target.kind === "hotspot") {
    const { path, line, side } = target.reference;
    return `hotspot:${target.hotspot.id}:${path}:${line}:${side}`;
  }
  return undefined;
}

type SavedFile = {
  filename: string;
  previousFilename?: string;
  status: string;
  patch?: string;
};
/** GitHub's per-file patch is hunks only; Pierre needs git file headers. */
export function toGitPatch(file: SavedFile & { patch: string }) {
  const from = file.previousFilename ?? file.filename;
  const header = [`diff --git a/${from} b/${file.filename}`];
  if (file.status === "added") header.push("new file mode 100644");
  if (file.status === "removed") header.push("deleted file mode 100644");
  // Pierre reads renames from the similarity line. GitHub gives no score; a
  // renamed file with a patch changed, so any value below 100% is accurate.
  if (from !== file.filename)
    header.push(
      "similarity index 50%",
      `rename from ${from}`,
      `rename to ${file.filename}`,
    );
  header.push(
    `--- ${file.status === "added" ? "/dev/null" : `a/${from}`}`,
    `+++ ${file.status === "removed" ? "/dev/null" : `b/${file.filename}`}`,
  );
  return `${header.join("\n")}\n${file.patch}`;
}

export function diffItemId(path: string) {
  return `diff:${path}`;
}

export type SavedDiff = { path: string; fileDiff: FileDiffMetadata };

export function parseSavedDiffs(files: SavedFile[]): SavedDiff[] {
  return files.flatMap((file) => {
    const fileDiff =
      file.patch &&
      processFile(toGitPatch({ ...file, patch: file.patch }), {
        isGitDiff: true,
        cacheKey: file.filename,
      });
    return fileDiff ? [{ path: file.filename, fileDiff }] : [];
  });
}

/**
 * One CodeView item per diff, with findings anchored on their changed line.
 * All saved files remain present; annotations and navigation only affect expansion.
 */
export function buildDiffItems(
  diffs: SavedDiff[],
  findings: ReviewFinding[],
  toggled: ReadonlySet<string>,
  hotspots: Hotspot[] = [],
  forcedPath?: string,
  allFindings: ReviewFinding[] = findings,
) {
  return diffs.map(({ path, fileDiff }): CodeViewDiffItem<ReviewAnnotation> => {
    const annotations = findings
      .filter((f) => f.path === path)
      .map((f): DiffLineAnnotation<ReviewAnnotation> => ({
        side: diffSideOf(f.side),
        lineNumber: f.line,
        metadata: { kind: "finding", finding: f },
      }));
    annotations.push(
      ...hotspots.flatMap((hotspot) =>
        hotspot.references
          .filter((reference) => reference.path === path)
          .map((reference): DiffLineAnnotation<ReviewAnnotation> => ({
            side: diffSideOf(reference.side),
            lineNumber: reference.line,
            metadata: { kind: "hotspot", hotspot, reference },
          })),
      ),
    );
    const hasContext =
      allFindings.some((finding) => finding.path === path) ||
      hotspots.some((hotspot) =>
        hotspot.references.some((ref) => ref.path === path),
      );
    const collapsed =
      path === forcedPath ? false : !hasContext !== toggled.has(path);
    return {
      id: diffItemId(path),
      type: "diff",
      fileDiff,
      annotations,
      collapsed,
      // CodeView re-renders an existing item only when its version changes.
      version: hashString(
        `${collapsed}:${annotations.map((a) => (a.metadata.kind === "finding" ? a.metadata.finding.id : a.metadata.hotspot.id + a.lineNumber)).join()}`,
      ),
    };
  });
}

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++)
    hash = (Math.imul(hash, 31) + value.charCodeAt(i)) | 0;
  return hash;
}
