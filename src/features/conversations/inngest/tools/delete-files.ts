import { z } from "zod";
import { createTool } from "@inngest/agent-kit";

import { convex } from "@/lib/convex-client";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

interface DeleteFilesToolOptions {
  projectId: Id<"projects">;
  internalKey: string;
}

const paramsSchema = z.object({
  fileIds: z
    .array(z.string().min(1, "File ID cannot be empty"))
    .min(1, "Provide at least one file ID"),
});

export const createDeleteFilesTool = ({
  projectId,
  internalKey,
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

      const resolved = await convex.query(api.system.agentResolveFileIdsInProject, {
        internalKey,
        projectId,
        rawIds: fileIds,
      });

      const invalid = resolved.filter((r) => r.status === "invalid");
      if (invalid.length > 0) {
        return `Error: Invalid file id(s) for this project: ${invalid.map((r) => `"${r.raw}"`).join(", ")}. Use listFiles to get valid file IDs.`;
      }

      const filesToDelete: {
        id: Id<"files">;
        name: string;
        type: string;
      }[] = [];

      for (const r of resolved) {
        if (r.status !== "ok") {
          continue;
        }
        const file = await convex.query(api.system.getFileById, {
          internalKey,
          fileId: r.fileId,
        });
        if (!file) {
          return `Error: File with ID "${r.raw}" not found. Use listFiles to get valid file IDs.`;
        }
        filesToDelete.push({
          id: file._id,
          name: file.name,
          type: file.type,
        });
      }

      try {
        return await toolStep?.run("delete-files", async () => {
          const results: string[] = [];

          for (const file of filesToDelete) {
            await convex.mutation(api.system.deleteFile, {
              internalKey,
              projectId,
              fileId: file.id,
            });

            results.push(`Deleted ${file.type} "${file.name}" successfully`);
          }

          return results.join("\n");
        });
      } catch (error) {
        return `Error deleting files: ${error instanceof Error ? error.message : "Unknown error"}`;
      }
    },
  });
};
