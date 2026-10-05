import { ChangeSet, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  mapPrediction,
  predictionState,
  resolvePrediction,
  setPrediction,
  predictionQueueState,
  resolvePredictions,
  setPredictionQueue,
} from "./prediction";
import { acceptPrediction, clearPredictions } from "./index";
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
  it("keeps insertion predictions when the selection moves", () => {
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
    ).toEqual(prediction);
  });
});

const queuedView = (
  doc: string,
  edits: { anchor: string; replacement: string }[],
  cursor = 0,
) => {
  let state = EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [predictionState],
  });
  state = state.update({
    effects: setPredictionQueue.of(
      resolvePredictions(doc, edits, cursor, [{ from: 0, to: doc.length }]),
    ),
  }).state;
  return {
    get state() {
      return state;
    },
    dispatch(spec: Parameters<EditorState["update"]>[0]) {
      state = state.update(spec).state;
    },
  } as EditorView;
};

describe("prediction queue", () => {
  it.each([
    { anchor: "old", replacement: "new" },
    { anchor: "", replacement: "!" },
  ])("applies immediately at the target for $anchor", (edit) => {
    const view = queuedView("xx old", [edit], 3);
    expect(acceptPrediction(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(
      edit.anchor ? "xx new" : "xx !old",
    );
    expect(view.state.field(predictionState)).toBeNull();
  });
  it.each([
    { anchor: "old", replacement: "new" },
    { anchor: "", replacement: "!" },
  ])("jumps again after moving away from $anchor", (edit) => {
    const view = queuedView("xx old", [edit], 3);
    view.dispatch({ selection: { anchor: 0 } });
    acceptPrediction(view);
    view.dispatch({ selection: { anchor: 6 } });
    expect(acceptPrediction(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("xx old");
    expect(view.state.selection.main.head).toBe(3);
    expect(acceptPrediction(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(
      edit.anchor ? "xx new" : "xx !old",
    );
  });
  it("collapses a nonempty selection with its head at the target before applying", () => {
    const view = queuedView("xx old", [{ anchor: "old", replacement: "new" }]);
    acceptPrediction(view);
    view.dispatch({ selection: { anchor: 6, head: 3 } });
    expect(acceptPrediction(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("xx old");
    expect(view.state.selection.main.empty).toBe(true);
    expect(view.state.selection.main.head).toBe(3);
    expect(acceptPrediction(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("xx new");
  });
  it("orders by distance to the target range with stable ties and drops duplicates", () => {
    const edits = [
      { anchor: "third", replacement: "3" },
      { anchor: "first", replacement: "1" },
      { anchor: "second", replacement: "2" },
      { anchor: "second", replacement: "2" },
    ];
    expect(
      resolvePredictions("first second third", edits, 8, [
        { from: 0, to: 18 },
      ]).map((edit) => edit.anchor),
    ).toEqual(["second", "first", "third"]);
  });
  it("chains Tab through edits and maps offsets after a longer replacement", () => {
    const view = queuedView("first second third", [
      { anchor: "third", replacement: "3" },
      { anchor: "first", replacement: "longer first" },
      { anchor: "second", replacement: "2" },
    ]);
    expect(acceptPrediction(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("longer first second third");
    expect(view.state.field(predictionState)).toMatchObject({
      anchor: "second",
      from: 13,
      jumped: false,
    });
    for (let i = 0; i < 4; i++) expect(acceptPrediction(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("longer first 2 3");
    expect(acceptPrediction(view)).toBe(false);
  });
  it("removes overlapping and newly ambiguous edits without losing valid edits", () => {
    const view = queuedView("first second third", [
      { anchor: "first", replacement: "second" },
      { anchor: "first second", replacement: "both" },
      { anchor: "second", replacement: "2" },
      { anchor: "third", replacement: "3" },
    ]);
    acceptPrediction(view);
    expect(
      view.state.field(predictionQueueState).map((edit) => edit.anchor),
    ).toEqual(["third"]);
  });
  it("reorders surviving edits from the cursor after applying an edit", () => {
    const view = queuedView(
      "left middle right",
      [
        { anchor: "left", replacement: "L" },
        { anchor: "middle", replacement: "M" },
        { anchor: "right", replacement: "R" },
      ],
      6,
    );
    acceptPrediction(view);
    acceptPrediction(view);
    expect(
      view.state.field(predictionQueueState).map((edit) => edit.anchor),
    ).toEqual(["right", "left"]);
  });
  it("invalidates only targets touched by user edits", () => {
    const view = queuedView("first second third", [
      { anchor: "first", replacement: "1" },
      { anchor: "second", replacement: "2" },
      { anchor: "third", replacement: "3" },
    ]);
    view.dispatch({ changes: { from: 7, to: 8, insert: "!" } });
    expect(
      view.state.field(predictionQueueState).map((edit) => edit.anchor),
    ).toEqual(["first", "third"]);
  });
  it("dismisses all predictions for a user input transaction", () => {
    const view = queuedView("first second", [
      { anchor: "first", replacement: "1" },
      { anchor: "second", replacement: "2" },
    ]);
    view.dispatch({
      changes: { from: 0, insert: "x" },
      userEvent: "input.type",
    });
    expect(view.state.field(predictionQueueState)).toEqual([]);
  });
  it("dismisses predictions for a user deletion transaction", () => {
    const view = queuedView("first second", [
      { anchor: "first", replacement: "1" },
      { anchor: "second", replacement: "2" },
    ]);
    view.dispatch({
      changes: { from: 0, to: 1 },
      userEvent: "delete.backward",
    });
    expect(view.state.field(predictionQueueState)).toEqual([]);
  });
  it("clears the entire queue on Escape even after jumping", () => {
    const view = queuedView(
      "first second",
      [
        { anchor: "first", replacement: "1" },
        { anchor: "second", replacement: "2" },
      ],
      1,
    );
    acceptPrediction(view);
    expect(clearPredictions(view)).toBe(true);
    expect(view.state.field(predictionQueueState)).toEqual([]);
    expect(clearPredictions(view)).toBe(false);
    expect(acceptPrediction(view)).toBe(false);
    expect(view.state.doc.toString()).toBe("first second");
  });
});
