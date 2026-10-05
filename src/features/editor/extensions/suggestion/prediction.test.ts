import { ChangeSet, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  mapPrediction,
  predictionState,
  resolvePrediction,
  setPrediction,
} from "./prediction";
import { acceptPrediction } from "./index";
import type { EditorView } from "@codemirror/view";

describe("predictions", () => {
  const edit = { anchor: "old", replacement: "new" };
  it("rejects missing, ambiguous and out-of-window anchors", () => {
    expect(
      resolvePrediction("old old", [edit], 0, [{ from: 0, to: 7 }]),
    ).toBeNull();
    expect(
      resolvePrediction("other", [edit], 0, [{ from: 0, to: 5 }]),
    ).toBeNull();
    expect(
      resolvePrediction("xx old", [edit], 0, [{ from: 0, to: 4 }]),
    ).toBeNull();
  });
  it("maps unrelated edits and invalidates changes inside the target", () => {
    const prediction = resolvePrediction("xx old", [edit], 0, [
      { from: 0, to: 6 },
    ])!;
    expect(
      mapPrediction(prediction, ChangeSet.of({ from: 0, insert: "!" }, 6)),
    ).toMatchObject({ from: 4, to: 7 });
    expect(
      mapPrediction(
        prediction,
        ChangeSet.of({ from: 4, to: 5, insert: "!" }, 6),
      ),
    ).toBeNull();
    expect(
      mapPrediction(prediction, ChangeSet.of({ from: 4, insert: "!" }, 6)),
    ).toBeNull();
  });
  it("jumps on the first Tab and replaces on the second, then leaves Tab unhandled", () => {
    let state = EditorState.create({
      doc: "xx old",
      extensions: [predictionState],
    });
    state = state.update({
      effects: setPrediction.of(
        resolvePrediction("xx old", [edit], 0, [{ from: 0, to: 6 }]),
      ),
    }).state;
    const view = {
      get state() {
        return state;
      },
      dispatch(spec: Parameters<EditorState["update"]>[0]) {
        state = state.update(spec).state;
      },
    } as EditorView;
    expect(acceptPrediction(view)).toBe(true);
    expect(state.selection.main.head).toBe(3);
    expect(state.doc.toString()).toBe("xx old");
    expect(acceptPrediction(view)).toBe(true);
    expect(state.doc.toString()).toBe("xx new");
    expect(acceptPrediction(view)).toBe(false);
  });
  it("inserts at cursor immediately and invalidates insertions when cursor moves", () => {
    const prediction = resolvePrediction(
      "xx",
      [{ anchor: "", replacement: "!" }],
      1,
      [],
    )!;
    let state = EditorState.create({
      doc: "xx",
      extensions: [predictionState],
    });
    state = state.update({
      selection: { anchor: 1 },
      effects: setPrediction.of(prediction),
    }).state;
    expect(
      state.update({ selection: { anchor: 2 } }).state.field(predictionState),
    ).toBeNull();
  });
});
