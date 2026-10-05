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
import { suggestion } from "../extensions/suggestion";
import { quickEdit } from "../extensions/quick-edit";
import { selectionTooltip } from "../extensions/selection-tooltip";
import type { ProjectSourceFile } from "../extensions/suggestion/related-context";

interface Props {
  fileName: string;
  /** Workspace-relative path of the Project file. */
  filePath: string;
  /** Other Project files, used to give autocomplete signatures from imports. */
  projectFiles: ProjectSourceFile[];
  openTabPaths: string[];
  initialValue?: string;
  onChange: (value: string) => void;
}
export const CodeEditor = ({
  fileName,
  filePath,
  projectFiles,
  openTabPaths,
  initialValue = "",
  onChange,
}: Props) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const filePathRef = useRef(filePath);
  const openTabPathsRef = useRef(openTabPaths);
  const projectFilesRef = useRef(projectFiles);
  useEffect(() => {
    filePathRef.current = filePath;
    projectFilesRef.current = projectFiles;
    openTabPathsRef.current = openTabPaths;
  }, [filePath, projectFiles, openTabPaths]);

  const languageExtension = useMemo(() => {
    return getLanguageExtension(fileName);
  }, [fileName]);

  useEffect(() => {
    if (!editorRef.current) return;
    const view = new EditorView({
      doc: initialValue,
      parent: editorRef.current,
      extensions: [
        customSetup,
        languageExtension,
        oneDark,
        customTheme,
        suggestion({
          getOpenTabPaths: () => openTabPathsRef.current,
          getPath: () => filePathRef.current,
          getProjectFiles: () => projectFilesRef.current,
        }),
        quickEdit(fileName),
        selectionTooltip(),
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
  return <div ref={editorRef} className="size-full pl-4 bg-background" />;
};
