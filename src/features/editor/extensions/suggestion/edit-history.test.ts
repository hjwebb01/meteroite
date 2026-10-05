import { ChangeSet, Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  MAX_HISTORY_CHARS,
  MAX_HUNKS,
  recordChanges,
  remapHunks,
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
  it("remaps retained hunks without recording a new change", () => {
    const startDoc = Text.of(["a", "b", "c"]);
    const endDoc = Text.of(["", "a", "b", "c"]);
    const changes = ChangeSet.of({ from: 0, insert: "\n" }, startDoc.length);
    const history: EditHunk[] = [
      { startLine: 3, endLine: 3, before: "c", after: "C" },
    ];

    expect(remapHunks(history, changes, startDoc, endDoc)).toEqual([
      { startLine: 4, endLine: 4, before: "c", after: "C" },
    ]);
  });

  it("keeps separate hunks for coalesced edits in one ChangeSet", () => {
    const startDoc = Text.of(["a", "b", "c"]);
    const changes = ChangeSet.of(
      [
        { from: 0, insert: "\n" },
        { from: 2, to: 3, insert: "B" },
      ],
      startDoc.length,
    );
    const endDoc = changes.apply(startDoc);
    const history = recordChanges([], changes, startDoc, endDoc);

    expect(history).toHaveLength(2);
    expect(history.map(({ before, after }) => [before, after])).toContainEqual([
      "b",
      "B",
    ]);
  });

  it("maps retained hunk lines across later newline edits", () => {
    const first = applyChange("a\nb\nc", [], 4, 5, "C");
    const shifted = applyChange(first.source, first.history, 0, 0, "\n");
    const updated = applyChange(
      shifted.source,
      shifted.history,
      shifted.source.indexOf("C") + 1,
      shifted.source.indexOf("C") + 1,
      "!",
    );

    expect(updated.history).toHaveLength(3);
    expect(updated.history[0]).toMatchObject({
      startLine: 4,
      endLine: 4,
      before: "c",
      after: "C",
    });
    expect(updated.history[1]).toMatchObject({ startLine: 1, endLine: 2 });
    expect(updated.history[2]).toMatchObject({
      startLine: 4,
      endLine: 4,
      before: "C",
      after: "C!",
    });
  });

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
