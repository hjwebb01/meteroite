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
export const setPredictionQueue = StateEffect.define<Prediction[]>();
export const advancePrediction = StateEffect.define<null>();

const orderPredictions = (queue: Prediction[], cursor: number) =>
  queue.sort(
    (a, b) =>
      Math.max(a.from - cursor, cursor - a.to, 0) -
      Math.max(b.from - cursor, cursor - b.to, 0),
  );

export const resolvePredictions = (
  doc: string,
  edits: readonly SuggestedEdit[],
  cursor: number,
  windows: readonly { from: number; to: number }[],
): Prediction[] => {
  const queue: Prediction[] = [];
  for (const edit of edits) {
    const prediction = resolvePrediction(doc, [edit], cursor, windows);
    if (
      prediction &&
      !queue.some(
        (item) =>
          item.from === prediction.from &&
          item.to === prediction.to &&
          item.replacement === prediction.replacement,
      )
    )
      queue.push(prediction);
  }
  return orderPredictions(queue, cursor);
};

export const predictionQueueState = StateField.define<Prediction[]>({
  create: () => [],
  update(queue, transaction) {
    if (transaction.effects.some((effect) => effect.is(advancePrediction)))
      queue = queue.slice(1);
    if (
      transaction.docChanged &&
      (transaction.isUserEvent("input") || transaction.isUserEvent("delete"))
    )
      queue = [];
    if (transaction.docChanged) {
      const doc = transaction.newDoc.toString();
      queue = queue.flatMap((prediction) => {
        const mapped = mapPrediction(prediction, transaction.changes);
        if (!mapped) return [];
        if (
          mapped.anchor &&
          (doc.slice(mapped.from, mapped.to) !== mapped.anchor ||
            doc.indexOf(mapped.anchor) !== mapped.from ||
            doc.indexOf(mapped.anchor, mapped.from + 1) !== -1)
        )
          return [];
        return [mapped];
      });
      queue = orderPredictions(queue, transaction.newSelection.main.head);
    }
    for (const effect of transaction.effects) {
      if (effect.is(setPrediction)) queue = effect.value ? [effect.value] : [];
      if (effect.is(setPredictionQueue)) queue = effect.value;
    }
    return queue;
  },
});

export const predictionState = StateField.define<Prediction | null>({
  create: () => null,
  update(_value, transaction) {
    return transaction.state.field(predictionQueueState)[0] ?? null;
  },
  provide: () => predictionQueueState,
});
