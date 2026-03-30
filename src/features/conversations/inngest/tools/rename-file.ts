import { z } from "zod";
import { createTool } from "@inngest/agent-kit";

import { convex } from "@/lib/convex-client";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

interface RenameFileToolOptions {
  projectId: Id<"projects">;
  internalKey: string;
}

const paramsSchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  newName: z.string().min(1, "New name is required"),
});

export const createRenameFileTool = ({
  projectId,
  internalKey,
}: RenameFileToolOptions) => {
  return createTool({
    name: "renameFile",
    description: "Rename a file or folder. Use id from listFiles exactly.",
    parameters: z.object({
      fileId: z.string().describe("The ID of the file or folder to rename"),
      newName: z.string().describe("The new name for the file or folder"),
    }),
    handler: async (params, { step: toolStep }) => {
      const parsed = paramsSchema.safeParse(params);
      if (!parsed.success) {
        return `Error: ${parsed.error.issues[0].message}`;
      }

      const { fileId, newName } = parsed.data;

      const resolved = await convex.query(api.system.agentResolveFileIdsInProject, {
        internalKey,
        projectId,
        rawIds: [fileId],
      });
      const first = resolved[0];
      if (!first || first.status !== "ok") {
        return `Error: File with ID "${fileId}" not found in this project. Use listFiles to get valid file IDs.`;
      }

      const file = await convex.query(api.system.getFileById, {
        internalKey,
        fileId: first.fileId,
      });

      if (!file) {
        return `Error: File with ID "${fileId}" not found. Use listFiles to get valid file IDs.`;
      }

      try {
        return await toolStep?.run("rename-file", async () => {
          await convex.mutation(api.system.renameFile, {
            internalKey,
            projectId,
            fileId: first.fileId,
            newName,
          });

          return `Renamed "${file.name}" to "${newName}" successfully`;
        });
      } catch (error) {
        return `Error renaming file: ${error instanceof Error ? error.message : "Unknown error"}`;
      }
    },
  });
};
