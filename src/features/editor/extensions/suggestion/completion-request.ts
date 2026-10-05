import type { Text } from "@codemirror/state";
import type { EditHunk } from "./edit-history";
import { buildRelatedContext, type ProjectSourceFile } from "./related-context";
import { CURSOR_MARKER } from "./prompt-format";
import type { SuggestionRequest } from "./suggestion-schema";

const LINES_BEFORE_CURSOR = 60;
const LINES_AFTER_CURSOR = 30;
const MAX_CODE_SNIPPET_CHARS = 6_000;

export interface CompletionRequestInput {
  doc: Text;
  cursor: number;
  /** Workspace-relative path of the Project file being edited. */
  path: string;
  /** Project files used to resolve imports; omit to send no related context. */
  projectFiles?: readonly ProjectSourceFile[];
  openTabPaths?: readonly string[];
  recentEdits?: readonly EditHunk[];
}

export const buildCompletionRequest = ({
  doc,
  cursor,
  path,
  projectFiles = [],
  recentEdits = [],
  openTabPaths = [],
}: CompletionRequestInput): SuggestionRequest | null => {
  const fullCode = doc.toString();
  if (fullCode.trim().length === 0) return null;

  const currentLine = doc.lineAt(cursor);
  let firstLine = Math.max(1, currentLine.number - LINES_BEFORE_CURSOR);
  let lastLine = Math.min(doc.lines, currentLine.number + LINES_AFTER_CURSOR);
  // Keep whole lines, including an unusually long cursor line even if it exceeds the budget.
  while (
    doc.line(lastLine).to - doc.line(firstLine).from > MAX_CODE_SNIPPET_CHARS &&
    (firstLine < currentLine.number || lastLine > currentLine.number)
  ) {
    if (
      currentLine.number - firstLine >= lastLine - currentLine.number &&
      firstLine < currentLine.number
    ) {
      firstLine++;
    } else {
      lastLine--;
    }
  }
  const from = doc.line(firstLine).from;
  const to = doc.line(lastLine).to;
  const code = `${firstLine > 1 ? "[…]\n" : ""}${doc.sliceString(from, cursor)}${CURSOR_MARKER}${doc.sliceString(cursor, to)}${lastLine < doc.lines ? "\n[…]" : ""}`;

  const relatedFiles = buildRelatedContext({
    path,
    source: fullCode,
    files: projectFiles,
    openTabPaths,
  });

  return {
    fileName: path.split("/").pop() ?? path,
    code,
    ...(relatedFiles.length > 0 && { relatedFiles }),
    ...(recentEdits.length > 0 && {
      recentEdits: recentEdits.map(({ before, after }) => ({ before, after })),
    }),
  };
};
