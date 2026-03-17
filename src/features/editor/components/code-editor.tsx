import { useEffect, useMemo, useRef } from "react";
import { EditorView } from "codemirror";
import { keymap } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import { customTheme } from "../extensions/theme";
import { getLanguageExtension } from "../extensions/language-extension";
import { indentWithTab } from "@codemirror/commands";
import { minimap } from "../extensions/minimap";
import { indentationMarkers } from "@replit/codemirror-indentation-markers";
import { customSetup } from "../extensions/custom-setup";

interface Props {
    filename: string;
    initialValue?: string;
    onChange: (value: string) => void;
}
export const CodeEditor = ({
    filename,
    initialValue = "",
    onChange,
}: Props) => {
    const editorRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);

    const languageExtension = useMemo(
        () => getLanguageExtension(filename),
        [filename],
    );
    useEffect(() => {
        if (!editorRef.current) return undefined;
        const view = new EditorView({
            doc: initialValue,
            parent: editorRef.current,
            extensions: [
                customSetup,
                languageExtension,
                oneDark,
                customTheme,
                keymap.of([indentWithTab]),
                minimap(),
                indentationMarkers(),
                EditorView.updateListener.of((update) => {
                    if (update.docChanged) {
                        onChange(update.view.state.doc.toString());
                    }
                }),
            ],
        });
        viewRef.current = view;

        return () => {
            view.destroy();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- initialValue is only used for initial document
    }, [languageExtension]);
    return (
        <div
            ref={editorRef}
            className="size-full pl-4 bg-background"
        />
    );
};
