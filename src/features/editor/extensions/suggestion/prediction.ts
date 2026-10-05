import { StateEffect, StateField, type ChangeDesc } from "@codemirror/state";

export interface SuggestedEdit {
  anchor: string;
  replacement: string;
}
export interface Prediction extends SuggestedEdit {
  from: number;
  to: number;
  jumped: boolean;
}

export const resolvePrediction = (
  doc: string,
  edits: readonly SuggestedEdit[],
  cursor: number,
  windows: readonly { from: number; to: number }[],
): Prediction | null => {
  for (const edit of edits) {
    if (!edit.anchor) {
      if (edit.replacement)
        return { ...edit, from: cursor, to: cursor, jumped: true };
      continue;
    }
    const from = doc.indexOf(edit.anchor);
    if (from < 0 || doc.indexOf(edit.anchor, from + 1) !== -1) continue;
    const to = from + edit.anchor.length;
    if (!windows.some((window) => from >= window.from && to <= window.to))
      continue;
    if (edit.anchor === edit.replacement) continue;
    return { ...edit, from, to, jumped: false };
  }
  return null;
};

export const mapPrediction = (
  prediction: Prediction,
  changes: ChangeDesc,
): Prediction | null => {
  let touched = false;
  changes.iterChangedRanges((from, to) => {
    if (
      prediction.from === prediction.to
        ? from <= prediction.from && to >= prediction.to
        : from === to
          ? from > prediction.from && from < prediction.to
          : from < prediction.to && to > prediction.from
    )
      touched = true;
  });
  if (touched) return null;
  return {
    ...prediction,
    from: changes.mapPos(prediction.from, 1),
    to: changes.mapPos(
      prediction.to,
      prediction.from === prediction.to ? 1 : -1,
    ),
  };
};

export const setPrediction = StateEffect.define<Prediction | null>();
export const predictionState = StateField.define<Prediction | null>({
  create: () => null,
  update(value, transaction) {
    if (value && transaction.docChanged)
      value = mapPrediction(value, transaction.changes);
    if (
      value?.anchor === "" &&
      transaction.selection &&
      transaction.selection.main.head !== value.from
    )
      value = null;
    for (const effect of transaction.effects) {
      if (effect.is(setPrediction)) value = effect.value;
    }
    return value;
  },
});
