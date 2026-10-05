import { FileSystemTree } from "@webcontainer/api";

import { Doc } from "../../../../convex/_generated/dataModel";
import { projectPaths } from "../../../../convex/lib/project-paths";

type FileDoc = Doc<"files">;

/**
 * Convert flat Convex files to nested FileSystemTree for WebContainer
 */
export const buildFileTree = (files: FileDoc[]): FileSystemTree => {
  const tree: FileSystemTree = {};
  const { pathById } = projectPaths(files);

  for (const file of files) {
    const pathParts = pathById.get(file._id)!.split("/");
    let current = tree;

    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i];
      const isLast = i === pathParts.length - 1;

      if (isLast) {
        // Leaf nodes become files, while folder docs become empty directories.
        if (file.type === "folder") {
          current[part] = { directory: {} };
        // Storage-backed files are skipped here because their contents are not inline.
        } else if (!file.storageId && file.content !== undefined) {
          current[part] = { file: { contents: file.content } };
        }
      } else {
        // Ensure each intermediate segment exists before descending into it.
        if (!current[part]) {
          current[part] = { directory: {} };
        }
        const node = current[part];
        if ("directory" in node) {
          current = node.directory;
        }
      }
    }
  }

  return tree;
};
