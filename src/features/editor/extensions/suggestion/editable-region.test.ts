import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { buildEditableRegion, regionToPredictions } from "./editable-region";

const apply = (original: string, rewritten: string, cursor = 0) => {
  const predictions = regionToPredictions(original, rewritten, 0, cursor);
  let result = original;
  for (const edit of [...predictions].sort((a, b) => b.from - a.from))
    result =
      result.slice(0, edit.from) + edit.replacement + result.slice(edit.to);
  return result;
};

describe("editable region", () => {
  it("builds a line-aligned window and budgeted complete context lines", () => {
    const doc = Text.of(["aaa", "bbb", "ccc", "ddd", "eee"]);
    const result = buildEditableRegion({
      doc,
      cursor: 9,
      linesAbove: 0,
      linesBelow: 0,
      contextChars: 4,
    });
    expect(result).toMatchObject({
      regionFrom: 8,
      regionTo: 12,
      contextBefore: "bbb\n",
      region: "c<|cursor|>cc\n",
      contextAfter: "ddd\n",
      recentEdits: "",
    });
  });
  it("handles document boundaries, empty documents, and recent diff text", () => {
    expect(buildEditableRegion({ doc: Text.empty, cursor: 0 }).region).toBe(
      "<|cursor|>",
    );
    const result = buildEditableRegion({
      doc: Text.of(["one", "two"]),
      cursor: 7,
      recentEdits: [{ startLine: 1, endLine: 1, before: "old", after: "one" }],
    });
    expect(result.region).toBe("one\ntwo<|cursor|>");
    expect(result.recentEdits).toBe("@@\n-old\n+one");
  });
  it("does not split oversized context lines", () => {
    const doc = Text.of(["long line", "x", "long line"]);
    expect(
      buildEditableRegion({
        doc,
        cursor: 10,
        linesAbove: 0,
        linesBelow: 0,
        contextChars: 2,
      }),
    ).toMatchObject({ contextBefore: "", contextAfter: "" });
  });
  it("returns no predictions for no-op rewrites", () => {
    expect(regionToPredictions("abc\n", "abc\n", 10, 11)).toEqual([]);
  });
  it("produces ghost text at the cursor with absolute offsets", () => {
    expect(regionToPredictions("ab", "a<|cursor|>Xb", 10, 11)).toEqual([
      { anchor: "", replacement: "X", from: 11, to: 11, jumped: true },
    ]);
  });
  it("minimizes a rename on another line", () => {
    expect(regionToPredictions("keep\nold();", "keep\nnew();", 0, 0)).toEqual([
      { anchor: "old", replacement: "new", from: 5, to: 8, jumped: false },
    ]);
  });
  it("orders separate hunks by cursor distance", () => {
    const edits = regionToPredictions(
      "old\nkeep\nold",
      "new\nkeep\nnew",
      0,
      12,
    );
    expect(edits.map((edit) => edit.from)).toEqual([9, 0]);
    expect(apply("old\nkeep\nold", "new\nkeep\nnew")).toBe("new\nkeep\nnew");
  });
  it("accepts dropped and duplicated markers", () => {
    expect(regionToPredictions("ab", "a<|cursor|><|cursor|>b", 0, 1)).toEqual(
      [],
    );
    expect(apply("ab", "aXb", 1)).toBe("aXb");
  });
  it("anchors off-cursor insertion to its containing line", () => {
    expect(regionToPredictions("abc\ndef", "abc\ndXef", 0, 0)).toEqual([
      { anchor: "def", replacement: "dXef", from: 4, to: 7, jumped: false },
    ]);
  });
  it("merges line anchors overlapping nearby edits", () => {
    expect(apply("abc def", "aXbc dEf", 0)).toBe("aXbc dEf");
    expect(apply("abc def", "aBc dXef", 0)).toBe("aBc dXef");
  });
  it("preserves CRLF offsets and unchanged line endings", () => {
    expect(
      regionToPredictions("a\r\nold\r\n", "a\r\nnew\r\n", 20, 20)[0],
    ).toMatchObject({ from: 23, to: 26, anchor: "old", replacement: "new" });
    expect(apply("a\r\nb\r\n", "a\r\nbX\r\n", 4)).toBe("a\r\nbX\r\n");
  });
  it.each([
    ["abc", "abc\n"],
    ["abc\n", "abc"],
    ["abc\r\n", "abc\n"],
    ["", "new"],
    ["abc", ""],
  ])("retains trailing newline differences: %j → %j", (original, rewritten) => {
    expect(apply(original, rewritten, original.length)).toBe(rewritten);
  });
  it("bounds work for a large rewritten line", () => {
    expect(apply("a".repeat(2000), "b".repeat(2000))).toBe("b".repeat(2000));
  });
});
