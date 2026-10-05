import type { ChangeSet, Text } from "@codemirror/state";

/**
 * A recently edited region of the open file. Lines are 1-based and refer to the document as it
 * is after the edit; `before` and `after` are the full text of those lines.
 */
export interface EditHunk {
  startLine: number;
  endLine: number;
  before: string;
  after: string;
}

export const MAX_HUNKS = 5;
export const MAX_HISTORY_CHARS = 2_000;
const MAX_SIDE_CHARS = 400;

const clip = (text: string) =>
  text.length > MAX_SIDE_CHARS ? `${text.slice(0, MAX_SIDE_CHARS)}…` : text;

const size = (hunk: EditHunk) => hunk.before.length + hunk.after.length;

const lines = (doc: Text, from: number, to: number) =>
  doc.sliceString(doc.lineAt(from).from, doc.lineAt(to).to);

const cap = (history: EditHunk[]) => {
  const capped = history.slice(-MAX_HUNKS);
  let total = capped.reduce((sum, hunk) => sum + size(hunk), 0);
  while (capped.length > 1 && total > MAX_HISTORY_CHARS) {
    total -= size(capped.shift()!);
  }
  return capped;
};

/**
 * Folds a user change into the history. An edit inside the most recent hunk's lines (typing a
 * word, deleting characters) extends that hunk instead of adding a new one.
 */
export const recordChanges = (
  history: readonly EditHunk[],
  changes: ChangeSet,
  startDoc: Text,
  endDoc: Text,
): EditHunk[] => {
  const next = [...history];
  const edits: { fromA: number; toA: number; fromB: number; toB: number }[] =
    [];
  changes.iterChanges((fromA, toA, fromB, toB) => {
    edits.push({ fromA, toA, fromB, toB });
  });
  const previous = [...next];
  for (let index = 0; index < next.length; index += 1) {
    const hunk = next[index];
    const start = changes.mapPos(startDoc.line(hunk.startLine).from, -1);
    const end = changes.mapPos(startDoc.line(hunk.endLine).to, 1);
    next[index] = {
      ...hunk,
      startLine: endDoc.lineAt(start).number,
      endLine: endDoc.lineAt(end).number,
    };
  }
  edits.forEach(({ fromA, toA, fromB, toB }, editIndex) => {
    const startLineA = startDoc.lineAt(fromA).number;
    const endLineA = startDoc.lineAt(toA).number;
    const startLineB = endDoc.lineAt(fromB).number;
    const endLineB = endDoc.lineAt(toB).number;
    const recentIndex = previous.length - 1;
    const recentHunk = previous[recentIndex];
    const previousIndex =
      edits.length === 1 &&
      recentHunk &&
      startLineA >= recentHunk.startLine &&
      endLineA <= recentHunk.endLine
        ? recentIndex
        : -1;
    const previousHunk = previousIndex >= 0 ? previous[previousIndex] : null;

    if (editIndex === 0 && previousHunk) {
      const mappedHunk = next[previousIndex];
      const after = lines(
        endDoc,
        endDoc.line(mappedHunk.startLine).from,
        endDoc.line(mappedHunk.endLine).to,
      );
      if (after !== previousHunk.before) {
        next[previousIndex] = { ...mappedHunk, after: clip(after) };
      } else {
        next.splice(previousIndex, 1);
      }
      return;
    }

    next.push({
      startLine: startLineB,
      endLine: endLineB,
      before: clip(lines(startDoc, fromA, toA)),
      after: clip(lines(endDoc, fromB, toB)),
    });
  });
  return cap(next);
};
