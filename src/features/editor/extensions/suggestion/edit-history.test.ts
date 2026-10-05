import { ChangeSet, Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  MAX_HISTORY_CHARS,
  MAX_HUNKS,
  recordChanges,
  type EditHunk,
} from "./edit-history";

const applyChange = (
  source: string,
  history: readonly EditHunk[],
  from: number,
  to: number,
  insert: string,
) => {
  const startDoc = Text.of(source.split("\n"));
  const changes = ChangeSet.of({ from, to, insert }, startDoc.length);
  const endDoc = changes.apply(startDoc);

  return {
    source: endDoc.toString(),
    history: recordChanges(history, changes, startDoc, endDoc),
  };
};

const historySize = (history: readonly EditHunk[]) =>
  history.reduce(
    (total, hunk) => total + hunk.before.length + hunk.after.length,
    0,
  );

describe("recordChanges", () => {
  it("coalesces consecutive keystrokes in one region into a net line change", () => {
    const original = "const value = 1;";
    const renamed = applyChange(original, [], 6, 11, "renamed");
    const updated = applyChange(
      renamed.source,
      renamed.history,
      renamed.source.length,
      renamed.source.length,
      " // keep editing",
    );

    expect(updated.history).toEqual([
      {
        startLine: 1,
        endLine: 1,
        before: original,
        after: "const renamed = 1; // keep editing",
      },
    ]);
  });

  it("keeps only the last few hunks and stays within the character cap", () => {
    let source = Array.from(
      { length: 8 },
      (_, index) =>
        "const value" + index + " = " + String.fromCharCode(97 + index) + ";",
    ).join("\n");
    let history: EditHunk[] = [];

    for (let index = 0; index < 8; index += 1) {
      const marker = "= " + String.fromCharCode(97 + index) + ";";
      const from = source.indexOf(marker) + 2;
      const result = applyChange(
        source,
        history,
        from,
        from + 1,
        String.fromCharCode(65 + index),
      );
      source = result.source;
      history = result.history;
    }

    expect(history).toHaveLength(MAX_HUNKS);

    source = ["a".repeat(500), "b".repeat(500), "c".repeat(500)].join("\n");
    history = [];
    for (const [index, replacement] of ["A", "B", "C"].entries()) {
      const from = source.indexOf(["a", "b", "c"][index]);
      const result = applyChange(source, history, from, from + 1, replacement);
      source = result.source;
      history = result.history;
    }

    expect(history).toHaveLength(2);
    expect(historySize(history)).toBeLessThanOrEqual(MAX_HISTORY_CHARS);
    expect(history.every((hunk) => hunk.before.length <= 401)).toBe(true);
    expect(history.every((hunk) => hunk.after.length <= 401)).toBe(true);
  });
});
