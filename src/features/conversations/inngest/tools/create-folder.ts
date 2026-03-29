import { z } from "zod";
import { createTool } from "@inngest/agent-kit";

import { convex } from "@/lib/convex-client";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

interface CreateFolderToolOptions {
  projectId: Id<"projects">;
  internalKey: string;
}

const paramsSchema = z.object({
  path: z
    .string()
    .min(1, "Folder path is required")
    .describe(
      "Workspace-relative folder path using forward slashes (e.g. src/components/ui). Creates missing parent folders. No leading slash.",
    ),
});

export const createCreateFolderTool = ({
  projectId,
  internalKey,
}: CreateFolderToolOptions) => {
  return createTool({
    name: "createFolder",
    description:
      "Create a folder at a workspace-relative path. Missing parent folders are created automatically. Prefer this over guessing parent folder IDs. Returns JSON with folderId, path, and createdNewFolders.",
    parameters: paramsSchema,
    handler: async (params, { step: toolStep }) => {
      const parsed = paramsSchema.safeParse(params);
      if (!parsed.success) {
        return `Error: ${parsed.error.issues[0]?.message ?? "Invalid parameters"}`;
      }

      const { path } = parsed.data;

      try {
        return await toolStep?.run("create-folder", async () => {
          const result = await convex.mutation(api.system.agentEnsureFolderPath, {
            internalKey,
            projectId,
            path,
          });
          return JSON.stringify(result);
        });
      } catch (error) {
        return `Error creating folder: ${error instanceof Error ? error.message : "Unknown error"}`;
      }
    },
  });
};
