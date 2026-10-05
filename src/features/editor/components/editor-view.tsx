import { Id } from "../../../../convex/_generated/dataModel";
import { TopNavigation } from "./top-navigation";
import { useEditor } from "../hooks/use-editor";
import { FileBreadcrumbs } from "./file-breadcrumbs";
import {
  useFile,
  useFiles,
  useFilePath,
  useUpdateFile,
} from "@/features/projects/hooks/use-files";
import Image from "next/image";
import { CodeEditor } from "./code-editor";
import { useEffect, useMemo, useRef } from "react";
import { projectPaths } from "../../../../convex/lib/project-paths";
import type { ProjectSourceFile } from "../extensions/suggestion/related-context";
import { AlertTriangleIcon } from "lucide-react";

const DEBOUNCE_MS = 1500;

export const EditorView = ({ projectId }: { projectId: Id<"projects"> }) => {
  const { activeTabId, openTabs } = useEditor(projectId);
  const activeFile = useFile(activeTabId);
  const filePath = useFilePath(activeTabId);
  const files = useFiles(projectId);
  const projectFiles = useMemo<ProjectSourceFile[]>(() => {
    if (!files) return [];
    const { pathById } = projectPaths(files);
    return files.flatMap((file) =>
      file.type === "file" && file.content !== undefined
        ? [{ path: pathById.get(file._id)!, content: file.content }]
        : [],
    );
  }, [files]);
  const openTabPaths = useMemo(() => {
    if (!files) return [];
    const { pathById } = projectPaths(files);
    return openTabs.flatMap((id) => {
      const path = pathById.get(id);
      return path ? [path] : [];
    });
  }, [files, openTabs]);
  const updateFile = useUpdateFile();
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const isActiveFileBinary = activeFile && activeFile.storageId;
  const isActiveFileText = activeFile && !activeFile.storageId;

  // cleanup pending debounced updates on unmount or file change
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [activeTabId]);
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center">
        <TopNavigation projectId={projectId} />
      </div>
      {activeTabId && <FileBreadcrumbs projectId={projectId} />}
      <div className="flex-1 min-h-0 bg-background">
        {!activeFile && (
          <div className="size-full flex items-center justify-center">
            <Image
              src="/alt-logo.svg"
              alt="Meteroite"
              width={50}
              height={50}
              className="opacity-25"
            />
          </div>
        )}
        {isActiveFileText && filePath && (
          <CodeEditor
            fileName={activeFile.name}
            filePath={filePath.map((entry) => entry.name).join("/")}
            projectFiles={projectFiles}
            openTabPaths={openTabPaths}
            key={activeFile._id}
            initialValue={activeFile.content}
            onChange={(content: string) => {
              if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
              }
              timeoutRef.current = setTimeout(() => {
                updateFile({ id: activeFile._id, content });
              }, DEBOUNCE_MS);
            }}
          />
        )}
        {isActiveFileBinary && (
          <div className="size-full flex items-center justify-center">
            <div className="flex flex-col items-center gap-2.5 max-w-md text-center">
              <AlertTriangleIcon className="size-10 text-yellow-500" />
              <p className="text-sm">
                The file is not displayed in the text editor because it is
                either binary or uses an unsupported text encoding.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
