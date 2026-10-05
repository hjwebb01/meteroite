import { z } from "zod";
import { defineProjectTool } from "./define-project-tool";
import { getConvexAdminClient } from "@/lib/convex-client";
import { internal } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

import { normalizeGeneratedFileContent } from "../normalize-generated-file-content";
import type { MessageProgressReporter } from "../message-progress";

interface UpdateFileToolArgs {
  projectId: Id<"projects">;
  reporter: MessageProgressReporter;
}

const paramsSchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  content: z.string(),
});

export const createUpdateFileTool = ({
  projectId,
  reporter,
}: UpdateFileToolArgs) => {
  return defineProjectTool({
    name: "updateFile",
    description:
      "Update the content of a file in the current project. Prefer identifying the file by workspace-relative path from listFiles; fileId must match listFiles exactly.",
    parameters: z.object({
      fileId: z.string().describe("The ID of the file to update (from listFiles)"),
      content: z
        .string()
        .describe(
          "The new content of the file with exact formatting preserved. Use real line breaks, not literal \\n sequences.",
        ),
    }),
    validation: paramsSchema,
    reporter,
    prepare: async (params) => {
      const { fileId } = params;
      const content = normalizeGeneratedFileContent(params.content);

      const resolved = await getConvexAdminClient().query(
        internal.agentFiles.agentResolveFileIdsInProject,
        {
          projectId,
          rawIds: [fileId],
        },
      );
      const first = resolved[0];
      if (!first || first.status !== "ok") {
        return `Error: No file found with ID "${fileId}" in this project. Use listFiles to get valid file IDs.`;
      }

      const file = await getConvexAdminClient().query(internal.agentFiles.getFileById, {
        fileId: first.fileId,
      });

      if (!file) {
        return `Error: No file found with ID "${fileId}". Use listFiles to get valid file IDs.`;
      }

      if (file.type === "folder") {
        return `Error:"${fileId}" is a folder. Use listFiles to get valid file IDs. You can only update file contents`;
      }

      return { file, fileId: first.fileId, content };
    },
    label: ({ file }) => file.name,
    formatError: (message, { file }) =>
      `Error: ${message} while updating file "${file.name}".`,
    run: async ({ file, fileId, content }) => {
      await getConvexAdminClient().mutation(internal.agentFiles.updateFile, {
        projectId,
        fileId,
        content,
      });
      return `File "${file.name}" updated successfully.`;
    },
  });
};
