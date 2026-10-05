import type { Text } from "@codemirror/state";
import type { EditHunk } from "./edit-history";
import { buildRelatedContext, type ProjectSourceFile } from "./related-context";

/** Full-file prompts are expensive; send a cursor-centered excerpt for large buffers. */
const MAX_CODE_SNIPPET_CHARS = 14_000;
const CURSOR_RADIUS_CHARS = 6_000;
const CONTEXT_LINES = 5;

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
}: CompletionRequestInput) => {
  const fullCode = doc.toString();
  if (fullCode.trim().length === 0) return null;

  const currentLine = doc.lineAt(cursor);
  const cursorInLine = cursor - currentLine.from;
  const previousLines: string[] = [];
  const previousLinesToFetch = Math.min(CONTEXT_LINES, currentLine.number - 1);
  for (let i = previousLinesToFetch; i >= 0; i--) {
    previousLines.push(doc.line(currentLine.number - i).text);
  }
  const nextLines: string[] = [];
  const nextLinesToFetch = Math.min(
    CONTEXT_LINES,
    doc.lines - currentLine.number,
  );
  for (let i = 1; i <= nextLinesToFetch; i++) {
    nextLines.push(doc.line(currentLine.number + i).text);
  }

  let code = fullCode;
  if (fullCode.length > MAX_CODE_SNIPPET_CHARS) {
    const lo = Math.max(0, cursor - CURSOR_RADIUS_CHARS);
    const hi = Math.min(fullCode.length, cursor + CURSOR_RADIUS_CHARS);
    const head = lo > 0 ? "[…]\n" : "";
    const tail = hi < fullCode.length ? "\n[…]" : "";
    code = `${head}${fullCode.slice(lo, hi)}${tail}`;
  }

  const relatedFiles = buildRelatedContext({
    path,
    source: fullCode,
    files: projectFiles,
    openTabPaths,
  });

  return {
    fileName: path.split("/").pop() ?? path,
    code,
    currentLine: currentLine.text,
    previousLines: previousLines.join("\n"),
    textBeforeCursor: currentLine.text.slice(0, cursorInLine),
    textAfterCursor: currentLine.text.slice(cursorInLine),
    nextLines: nextLines.join("\n"),
    lineNumber: currentLine.number,
    ...(relatedFiles.length > 0 && { relatedFiles }),
    ...(recentEdits.length > 0 && { recentEdits: [...recentEdits] }),
  };
};
