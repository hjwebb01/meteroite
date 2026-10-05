import type { Text } from "@codemirror/state";
import type { EditHunk } from "./edit-history";
import type { Prediction } from "./prediction";
import { CURSOR_MARKER, formatRecentEdits } from "./prompt-format";

export const buildEditableRegion = ({
  doc,
  cursor,
  recentEdits = [],
  linesAbove = 10,
  linesBelow = 15,
  contextChars = 4_000,
}: {
  doc: Text;
  cursor: number;
  recentEdits?: readonly EditHunk[];
  linesAbove?: number;
  linesBelow?: number;
  contextChars?: number;
}) => {
  const line = doc.lineAt(cursor).number;
  const first = Math.max(1, line - Math.max(0, Math.floor(linesAbove)));
  const last = Math.min(doc.lines, line + Math.max(0, Math.floor(linesBelow)));
  const regionFrom = doc.line(first).from;
  const regionTo = last < doc.lines ? doc.line(last + 1).from : doc.length;
  let before = first;
  let after = last + 1;
  while (before > 1 && regionFrom - doc.line(before - 1).from <= contextChars)
    before--;
  while (
    after <= doc.lines &&
    (after < doc.lines ? doc.line(after + 1).from : doc.length) - regionTo <=
      contextChars
  )
    after++;
  return {
    regionFrom,
    regionTo,
    contextBefore: doc.sliceString(doc.line(before).from, regionFrom),
    region:
      doc.sliceString(regionFrom, cursor) +
      CURSOR_MARKER +
      doc.sliceString(cursor, regionTo),
    contextAfter: doc.sliceString(
      regionTo,
      after <= doc.lines ? doc.line(after).from : doc.length,
    ),
    recentEdits: formatRecentEdits(recentEdits),
  };
};

type Hunk = { from: number; to: number; replacement: string };

// LCS over lines first, then UTF-16 characters, preserving CodeMirror offsets and CRLF.
const diff = (a: string[], b: string[]): Hunk[] => {
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix])
    prefix++;
  let endA = a.length,
    endB = b.length;
  while (endA > prefix && endB > prefix && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const offset = a.slice(0, prefix).join("").length;
  a = a.slice(prefix, endA);
  b = b.slice(prefix, endB);
  if (!a.length && !b.length) return [];
  // Bound memory for unusually large, entirely rewritten lines.
  if (a.length * b.length > 1_000_000)
    return [
      { from: offset, to: offset + a.join("").length, replacement: b.join("") },
    ];
  const rows = Array.from(
    { length: a.length + 1 },
    () => new Uint32Array(b.length + 1),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      rows[i][j] =
        a[i] === b[j]
          ? rows[i + 1][j + 1] + 1
          : Math.max(rows[i + 1][j], rows[i][j + 1]);
  const hunks: Hunk[] = [];
  let i = 0,
    j = 0,
    pos = offset,
    hunk: Hunk | undefined;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      hunk = undefined;
      pos += a[i++].length;
      j++;
    } else {
      if (!hunk) {
        hunk = { from: pos, to: pos, replacement: "" };
        hunks.push(hunk);
      }
      if (j < b.length && (i === a.length || rows[i][j + 1] > rows[i + 1][j]))
        hunk.replacement += b[j++];
      else {
        pos += a[i++].length;
        hunk.to = pos;
      }
    }
  }
  return hunks;
};

export const regionToPredictions = (
  original: string,
  rewritten: string,
  regionFrom: number,
  cursor: number,
): Prediction[] => {
  rewritten = rewritten.split(CURSOR_MARKER).join("");
  const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const hunks = diff(lines(original), lines(rewritten)).flatMap((hunk) =>
    diff(
      original.slice(hunk.from, hunk.to).split(""),
      hunk.replacement.split(""),
    ).map((change) => ({
      ...change,
      from: change.from + hunk.from,
      to: change.to + hunk.from,
    })),
  );
  // Non-cursor insertions borrow their containing line for a nonempty anchor.
  // Merge overlapping expanded ranges so queued predictions never conflict.
  const groups: { from: number; to: number; edits: Hunk[] }[] = [];
  for (const hunk of hunks) {
    let { from, to } = hunk;
    if (from === to && regionFrom + from !== cursor && original.length) {
      from = original.lastIndexOf("\n", from - 1) + 1;
      const end = original.indexOf("\n", to);
      to = end < 0 ? original.length : end + 1;
      if (from === to) from = Math.max(0, from - 1);
    }
    const previous = groups.at(-1);
    if (previous && from <= previous.to) {
      previous.from = Math.min(previous.from, from);
      previous.to = Math.max(previous.to, to);
      previous.edits.push(hunk);
    } else groups.push({ from, to, edits: [hunk] });
  }
  return groups
    .map(({ from, to, edits }) => {
      let replacement = "",
        pos = from;
      for (const edit of edits) {
        replacement += original.slice(pos, edit.from) + edit.replacement;
        pos = edit.to;
      }
      replacement += original.slice(pos, to);
      return {
        anchor: original.slice(from, to),
        replacement,
        from: regionFrom + from,
        to: regionFrom + to,
        jumped: from === to && regionFrom + from === cursor,
      };
    })
    .sort(
      (a, b) =>
        Math.max(a.from - cursor, cursor - a.to, 0) -
        Math.max(b.from - cursor, cursor - b.to, 0),
    );
};
