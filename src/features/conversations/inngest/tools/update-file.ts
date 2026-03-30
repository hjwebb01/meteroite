import { z } from "zod";
import { createTool } from "@inngest/agent-kit";
import { convex } from "@/lib/convex-client";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

import { normalizeGeneratedFileContent } from "../normalize-generated-file-content";

interface UpdateFileToolArgs {
  projectId: Id<"projects">;
  internalKey: string;
}

const paramsSchema = z.object({
  fileId: z.string().min(1, "File ID is required"),
  content: z.string(),
});

export const createUpdateFileTool = ({
  projectId,
  internalKey,
}: UpdateFileToolArgs) => {
  return createTool({
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
    handler: async (params, { step: toolStep }) => {
      const parsed = paramsSchema.safeParse(params);
      if (!parsed.success) {
        return `Error: ${parsed.error.issues[0].message}`;
      }
      const { fileId } = parsed.data;
      const content = normalizeGeneratedFileContent(parsed.data.content);

      const resolved = await convex.query(api.system.agentResolveFileIdsInProject, {
        internalKey,
        projectId,
        rawIds: [fileId],
      });
      const first = resolved[0];
      if (!first || first.status !== "ok") {
        return `Error: No file found with ID "${fileId}" in this project. Use listFiles to get valid file IDs.`;
      }

      const file = await convex.query(api.system.getFileById, {
        internalKey,
        fileId: first.fileId,
      });

      if (!file) {
        return `Error: No file found with ID "${fileId}". Use listFiles to get valid file IDs.`;
      }

      if (file.type === "folder") {
        return `Error:"${fileId}" is a folder. Use listFiles to get valid file IDs. You can only update file contents`;
      }

      try {
        return await toolStep?.run("update-file", async () => {
          await convex.mutation(api.system.updateFile, {
            internalKey,
            projectId,
            fileId: first.fileId,
            content,
          });
          return `File "${file.name}" updated successfully.`;
        });
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : "Unknown error"} while updating file "${file.name}".`;
      }
    },
  });
};
