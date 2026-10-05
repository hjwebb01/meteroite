import { z } from "zod";
import { defineProjectTool } from "./define-project-tool";

import { getConvexAdminClient } from "@/lib/convex-client";

import { internal } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { MessageProgressReporter } from "../message-progress";

interface RenameFileToolOptions {
  projectId: Id<"projects">;
  reporter: MessageProgressReporter;
}

const paramsSchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  newName: z.string().min(1, "New name is required"),
});

export const createRenameFileTool = ({
  projectId,
  reporter,
}: RenameFileToolOptions) => {
  return defineProjectTool({
    name: "renameFile",
    description: "Rename a file or folder. Use id from listFiles exactly.",
    parameters: z.object({
      fileId: z.string().describe("The ID of the file or folder to rename"),
      newName: z.string().describe("The new name for the file or folder"),
    }),
    validation: paramsSchema,
    reporter,
    prepare: async (params) => {
      const { fileId, newName } = params;

      const resolved = await getConvexAdminClient().query(
        internal.agentFiles.agentResolveFileIdsInProject,
        {
          projectId,
          rawIds: [fileId],
        },
      );
      const first = resolved[0];
      if (!first || first.status !== "ok") {
        return `Error: File with ID "${fileId}" not found in this project. Use listFiles to get valid file IDs.`;
      }

      const file = await getConvexAdminClient().query(internal.agentFiles.getFileById, {
        fileId: first.fileId,
      });

      if (!file) {
        return `Error: File with ID "${fileId}" not found. Use listFiles to get valid file IDs.`;
      }

      return { file, fileId: first.fileId, newName };
    },
    label: ({ file, newName }) => `“${file.name}” → “${newName}”`,
    errorPrefix: "Error renaming file",
    run: async ({ file, fileId, newName }) => {
      await getConvexAdminClient().mutation(internal.agentFiles.renameFile, {
        projectId,
        fileId,
        newName,
      });

      return `Renamed "${file.name}" to "${newName}" successfully`;
    },
  });
};
