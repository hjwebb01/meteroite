import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
  keymap,
  gutter,
  GutterMarker,
} from "@codemirror/view";
import { Prec, StateField } from "@codemirror/state";
import {
  predictionState,
  setPrediction,
  resolvePredictions,
  predictionQueueState,
  setPredictionQueue,
  advancePrediction,
} from "./prediction";
import { fetcher } from "./fetcher";
import { buildCompletionRequest } from "./completion-request";
import { recordChanges, type EditHunk } from "./edit-history";
import type { ProjectSourceFile } from "./related-context";

/** Recent user edits in this editor; a new editor per Project file resets it. */
const editHistoryState = StateField.define<EditHunk[]>({
  create() {
    return [];
  },
  update(history, transaction) {
    if (!transaction.docChanged) return history;
    return recordChanges(
      history,
      transaction.changes,
      transaction.startState.doc,
      transaction.state.doc,
    );
  },
});

interface SuggestionOptions {
  getOpenTabPaths: () => readonly string[];
  getPath: () => string;
  getProjectFiles: () => readonly ProjectSourceFile[];
}

// WidgetType: Creates custom DOM elements to display in the editor.
// toDom() is called by codemirror to create the actual html element.
class SuggestionWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  toDOM() {
    const span = document.createElement("span");
    span.textContent = this.text;
    span.style.opacity = "0.5";
    span.style.pointerEvents = "none";
    return span;
  }
}

const DEBOUNCE_DELAY = 300;

const createDebouncePlugin = ({
  getPath,
  getProjectFiles,
  getOpenTabPaths,
}: SuggestionOptions) => {
  return ViewPlugin.fromClass(
    class {
      debounceTimer: number | null = null;
      currentAbortController: AbortController | null = null;
      constructor(view: EditorView) {
        this.triggerSuggestion(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.triggerSuggestion(update.view);
        }
      }

      triggerSuggestion(view: EditorView) {
        if (this.debounceTimer !== null) {
          clearTimeout(this.debounceTimer);
        }
        if (this.currentAbortController !== null) {
          this.currentAbortController.abort();
        }

        if (view.state.field(predictionState)) return;
        this.debounceTimer = window.setTimeout(async () => {
          const payload = buildCompletionRequest({
            doc: view.state.doc,
            cursor: view.state.selection.main.head,
            path: getPath(),
            projectFiles: getProjectFiles(),
            openTabPaths: getOpenTabPaths(),
            recentEdits: view.state.field(editHistoryState),
          });
          if (!payload) {
            view.dispatch({
              effects: setPrediction.of(null),
            });
            return;
          }
          this.currentAbortController = new AbortController();
          const requestDoc = view.state.doc;
          const requestCursor = view.state.selection.main.head;
          const controller = this.currentAbortController;
          const edits = await fetcher(
            payload,
            this.currentAbortController.signal,
          );
          if (
            controller.signal.aborted ||
            view.state.field(predictionState) !== null ||
            view.state.doc !== requestDoc
          )
            return;
          view.dispatch({
            effects: setPredictionQueue.of(
              resolvePredictions(
                requestDoc.toString(),
                edits ?? [],
                requestCursor,
                view.visibleRanges,
              ),
            ),
          });
        }, DEBOUNCE_DELAY);
      }
      destroy() {
        if (this.debounceTimer !== null) {
          clearTimeout(this.debounceTimer);
        }
        if (this.currentAbortController !== null) {
          this.currentAbortController.abort();
        }
      }
    },
  );
};
const renderPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate) {
      const suggestionChanged = update.transactions.some((transaction) => {
        return transaction.effects.some((effect) => {
          return (
            effect.is(setPrediction) ||
            effect.is(setPredictionQueue) ||
            effect.is(advancePrediction)
          );
        });
      });
      const shouldRebuild =
        update.docChanged || update.selectionSet || suggestionChanged;

      if (shouldRebuild) {
        this.decorations = this.build(update.view);
      }
    }
    build(view: EditorView) {
      const suggestion = view.state.field(predictionState);
      if (!suggestion) {
        return Decoration.none;
      }

      const decorations = [
        Decoration.widget({
          widget: new SuggestionWidget(suggestion.replacement),
          side: 1,
        }).range(suggestion.to),
      ];
      if (suggestion.to > suggestion.from)
        decorations.push(
          Decoration.mark({
            attributes: {
              style: "text-decoration: line-through; opacity: 0.6",
            },
          }).range(suggestion.from, suggestion.to),
        );
      return Decoration.set(decorations, true);
    }
  },

  {
    decorations: (plugin) => plugin.decorations,
  },
);
export const acceptPrediction = (view: EditorView) => {
  const prediction = view.state.field(predictionState);
  if (!prediction) return false;
  if (!prediction.jumped) {
    view.dispatch({
      selection: { anchor: prediction.from },
      effects: [
        setPredictionQueue.of([
          { ...prediction, jumped: true },
          ...view.state.field(predictionQueueState).slice(1),
        ]),
        EditorView.scrollIntoView(prediction.from),
      ],
    });
  } else {
    view.dispatch({
      changes: {
        from: prediction.from,
        to: prediction.to,
        insert: prediction.replacement,
      },
      selection: { anchor: prediction.from + prediction.replacement.length },
      effects: advancePrediction.of(null),
    });
  }
  return true;
};

export const clearPredictions = (view: EditorView) => {
  if (!view.state.field(predictionState)) return false;
  view.dispatch({ effects: setPrediction.of(null) });
  return true;
};

const acceptSuggestionKeymap = Prec.highest(
  keymap.of([
    { key: "Tab", run: acceptPrediction },
    {
      key: "Escape",
      run: clearPredictions,
    },
  ]),
);

class PredictionMarker extends GutterMarker {
  toDOM() {
    const marker = document.createElement("span");
    marker.textContent = "✦";
    marker.title = "Suggested edit: Tab to jump, Tab again to apply";
    return marker;
  }
}
const marker = new PredictionMarker();
export const predictionGutter = gutter({
  lineMarker(view, line) {
    return view.state
      .field(predictionQueueState)
      .some(
        (prediction) =>
          view.state.doc.lineAt(prediction.from).from === line.from,
      )
      ? marker
      : null;
  },
  lineMarkerChange: (update) =>
    update.docChanged ||
    update.transactions.some((transaction) =>
      transaction.effects.some(
        (effect) =>
          effect.is(setPrediction) ||
          effect.is(setPredictionQueue) ||
          effect.is(advancePrediction),
      ),
    ),
});

export const suggestion = (options: SuggestionOptions) => [
  predictionState,
  editHistoryState,
  renderPlugin,
  predictionGutter,
  acceptSuggestionKeymap,
  createDebouncePlugin(options),
];
