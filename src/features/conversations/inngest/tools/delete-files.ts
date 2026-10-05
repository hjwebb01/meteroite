import { z } from "zod";
import { defineProjectTool } from "./define-project-tool";

import { getConvexAdminClient } from "@/lib/convex-client";

import { internal } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { MessageProgressReporter } from "../message-progress";

interface DeleteFilesToolOptions {
  projectId: Id<"projects">;
  reporter: MessageProgressReporter;
}

const paramsSchema = z.object({
  fileIds: z
    .array(z.string().min(1, "File ID cannot be empty"))
    .min(1, "Provide at least one file ID"),
});

export const createDeleteFilesTool = ({
  projectId,
  reporter,
}: DeleteFilesToolOptions) => {
  return defineProjectTool({
    name: "deleteFiles",
    description:
      "Delete files or folders from the project. If deleting a folder, all contents will be deleted recursively. Use ids from listFiles exactly.",
    parameters: z.object({
      fileIds: z
        .array(z.string())
        .describe("Array of file or folder IDs to delete"),
    }),
    validation: paramsSchema,
    reporter,
    label: ({ fileIds }) => `${fileIds.length} item(s)`,
    errorPrefix: "Error deleting files",
    run: async ({ fileIds }) => {
      const results = await getConvexAdminClient().mutation(internal.agentFiles.agentDeleteFiles, {
        projectId,
        rawIds: fileIds,
      });
      return results
        .map((result) =>
          result.alreadyMissing
            ? `File with ID "${result.fileId}" is already deleted`
            : `Deleted ${result.type} "${result.name}" successfully`,
        )
        .join("\n");
    },
  });
};
