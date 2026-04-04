import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
  keymap,
} from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";
import { fetcher } from "./fetcher";

const setSuggestionEffect = StateEffect.define<string | null>();
const suggestionState = StateField.define<string | null>({
  create() {
    return null;
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setSuggestionEffect)) {
        return effect.value;
      }
    }
    return value;
  },
});

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

let debounceTimer: number | null = null;
let isWaitingForSuggestion = false;
const DEBOUNCE_DELAY = 300;

let currentAbortController: AbortController | null = null;

/** Full-file prompts are expensive; send a cursor-centered excerpt for large buffers. */
const MAX_CODE_SNIPPET_CHARS = 14_000;
const CURSOR_RADIUS_CHARS = 6_000;

const generatePayload = (view: EditorView, fileName: string) => {
  const fullCode = view.state.doc.toString();
  if (!fullCode || fullCode.trim().length === 0) return null;

  const cursorPosition = view.state.selection.main.head;
  const currentLine = view.state.doc.lineAt(cursorPosition);
  const cursorInLine = cursorPosition - currentLine.from;
  const previousLines: string[] = [];
  const previousLinesToFetch = Math.min(5, currentLine.number - 1);
  for (let i = previousLinesToFetch; i >= 0; i--) {
    previousLines.push(view.state.doc.line(currentLine.number - i).text);
  }
  const nextLines: string[] = [];
  const totalLines = view.state.doc.lines;
  const nextLinesToFetch = Math.min(5, totalLines - currentLine.number);
  for (let i = 1; i <= nextLinesToFetch; i++) {
    nextLines.push(view.state.doc.line(currentLine.number + i).text);
  }

  let code = fullCode;
  if (fullCode.length > MAX_CODE_SNIPPET_CHARS) {
    const lo = Math.max(0, cursorPosition - CURSOR_RADIUS_CHARS);
    const hi = Math.min(fullCode.length, cursorPosition + CURSOR_RADIUS_CHARS);
    const head = lo > 0 ? "[…]\n" : "";
    const tail = hi < fullCode.length ? "\n[…]" : "";
    code = `${head}${fullCode.slice(lo, hi)}${tail}`;
  }

  return {
    fileName,
    code,
    currentLine: currentLine.text,
    previousLines: previousLines.join("\n"),
    textBeforeCursor: currentLine.text.slice(0, cursorInLine),
    textAfterCursor: currentLine.text.slice(cursorInLine),
    nextLines: nextLines.join("\n"),
    lineNumber: currentLine.number,
  };
};

const createDebouncePlugin = (fileName: string) => {
  return ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        this.triggerSuggestion(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet) {
          this.triggerSuggestion(update.view);
        }
      }

      triggerSuggestion(view: EditorView) {
        if (debounceTimer !== null) {
          clearTimeout(debounceTimer);
        }
        if (currentAbortController !== null) {
          currentAbortController.abort();
        }

        currentAbortController = new AbortController();
        isWaitingForSuggestion = true;
        debounceTimer = window.setTimeout(async () => {
          const payload = generatePayload(view, fileName);
          if (!payload) {
            isWaitingForSuggestion = false;
            view.dispatch({
              effects: setSuggestionEffect.of(null),
            });
            return;
          }
          currentAbortController = new AbortController();
          const suggestion = await fetcher(
            payload,
            currentAbortController.signal,
          );
          isWaitingForSuggestion = false;
          view.dispatch({
            effects: setSuggestionEffect.of(suggestion),
          });
        }, DEBOUNCE_DELAY);
      }
      destroy() {
        if (debounceTimer !== null) {
          clearTimeout(debounceTimer);
        }
        if (currentAbortController !== null) {
          currentAbortController.abort();
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
          return effect.is(setSuggestionEffect);
        });
      });
      const shouldRebuild =
        update.docChanged || update.selectionSet || suggestionChanged;

      if (shouldRebuild) {
        this.decorations = this.build(update.view);
      }
    }
    build(view: EditorView) {
      if (isWaitingForSuggestion) return Decoration.none;

      const suggestion = view.state.field(suggestionState);
      if (!suggestion) {
        return Decoration.none;
      }

      const cursor = view.state.selection.main.head;
      return Decoration.set([
        Decoration.widget({
          widget: new SuggestionWidget(suggestion),
          side: 1,
        }).range(cursor),
      ]);
    }
  },

  {
    decorations: (plugin) => plugin.decorations,
  },
);
const acceptSuggestionKeymap = keymap.of([
  {
    key: "Tab",
    run: (view) => {
      const suggestion = view.state.field(suggestionState);
      if (!suggestion) return false;

      const cursor = view.state.selection.main.head;
      view.dispatch({
        changes: {
          from: cursor,
          insert: suggestion,
        },
        selection: {
          anchor: cursor + suggestion.length,
        },
        effects: setSuggestionEffect.of(null),
      });
      return true;
    },
  },
]);
export const suggestion = (fileName: string) => [
  suggestionState,
  renderPlugin,
  acceptSuggestionKeymap,
  createDebouncePlugin(fileName),
];
