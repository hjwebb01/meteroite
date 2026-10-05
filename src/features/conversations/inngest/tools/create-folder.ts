import { z } from "zod";
import { defineProjectTool } from "./define-project-tool";

import { convex } from "@/lib/convex-client";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { MessageProgressReporter } from "../message-progress";

interface CreateFolderToolOptions {
  projectId: Id<"projects">;
  internalKey: string;
  reporter: MessageProgressReporter;
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
  reporter,
}: CreateFolderToolOptions) => {
  return defineProjectTool({
    name: "createFolder",
    description:
      "Create a folder at a workspace-relative path. Missing parent folders are created automatically. Prefer this over guessing parent folder IDs. Returns JSON with folderId, path, and createdNewFolders.",
    parameters: paramsSchema,
    validation: paramsSchema,
    reporter,
    label: ({ path }) => path,
    errorPrefix: "Error creating folder",
    run: async ({ path }) => {
      const result = await convex.mutation(api.system.agentEnsureFolderPath, {
        internalKey,
        projectId,
        path,
      });
      return JSON.stringify(result);
    },
  });
};
