import { z } from "zod";
import { createTool } from "@inngest/agent-kit";
import { convex } from "@/lib/convex-client";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

interface ReadFilesToolArgs {
  internalKey: string;
}

const paramsSchema = z.object({
  fileIds: z
    .array(z.string().min(1, "File ID is required"))
    .min(1, "At least one file ID is required"),
});

export const createReadFilesTool = ({ internalKey }: ReadFilesToolArgs) => {
  return createTool({
    name: "readFiles",
    description:
      "Read one or more files from the current project by file ID and return their contents.",
    parameters: z.object({
      fileIds: z.array(z.string()).describe("The IDs of the files to read"),
    }),
    handler: async (params, { step: toolStep }) => {
      const parsed = paramsSchema.safeParse(params);
      if (!parsed.success) {
        return `Error: ${parsed.error.issues[0].message}`;
      }
      const { fileIds } = parsed.data;

      try {
        return await toolStep?.run("read-files", async () => {
          const results: { id: string; name: string; content: string }[] = [];
          for (const fileId of fileIds) {
            const file = await convex.query(api.system.getFileById, {
              internalKey,
              fileId: fileId as Id<"files">,
            });
            if (file && file.content) {
              results.push({
                id: file._id,
                name: file.name,
                content: file.content,
              });
            }
          }
          if (results.length === 0) {
            return "Error: No files found with the given IDs. Use listFiles to get valid file IDs.";
          }
          return JSON.stringify(results);
        });
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : "Unknown error"}`;
      }
    },
  });
};
