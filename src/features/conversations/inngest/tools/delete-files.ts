import { z } from "zod";
import { createTool } from "@inngest/agent-kit";

import { convex } from "@/lib/convex-client";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { MessageProgressReporter } from "../message-progress";

interface DeleteFilesToolOptions {
  projectId: Id<"projects">;
  internalKey: string;
  reporter: MessageProgressReporter;
}

const paramsSchema = z.object({
  fileIds: z
    .array(z.string().min(1, "File ID cannot be empty"))
    .min(1, "Provide at least one file ID"),
});

export const createDeleteFilesTool = ({
  projectId,
  internalKey,
  reporter,
}: DeleteFilesToolOptions) => {
  return createTool({
    name: "deleteFiles",
    description:
      "Delete files or folders from the project. If deleting a folder, all contents will be deleted recursively. Use ids from listFiles exactly.",
    parameters: z.object({
      fileIds: z
        .array(z.string())
        .describe("Array of file or folder IDs to delete"),
    }),
    handler: async (params, { step: toolStep }) => {
      const parsed = paramsSchema.safeParse(params);
      if (!parsed.success) {
        return `Error: ${parsed.error.issues[0].message}`;
      }

      const { fileIds } = parsed.data;

      const progressId = await reporter.toolStart(
        "deleteFiles",
        `${fileIds.length} item(s)`,
      );

      try {
        const out = await toolStep?.run("delete-files", async () => {
          const results = await convex.mutation(api.system.agentDeleteFiles, {
            internalKey,
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
        });
        await reporter.toolEnd(progressId, true);
        return out ?? "";
      } catch (error) {
        await reporter.toolEnd(
          progressId,
          false,
          error instanceof Error ? error.message : "Unknown error",
        );
        return `Error deleting files: ${error instanceof Error ? error.message : "Unknown error"}`;
      }
    },
  });
};
