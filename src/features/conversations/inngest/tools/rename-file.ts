import { z } from "zod";
import { defineProjectTool } from "./define-project-tool";
import { getConvexAdminClient } from "@/lib/convex-client";
import { internal } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { MessageProgressReporter } from "../message-progress";

export const createRenameFileTool = ({
  projectId,
  reporter,
}: {
  projectId: Id<"projects">;
  reporter: MessageProgressReporter;
}) =>
  defineProjectTool({
    name: "renameFile",
    description:
      "Rename a file or folder by workspace-relative path within its current parent folder.",
    parameters: z.object({
      path: z
        .string()
        .min(1)
        .describe("Workspace-relative path of the file or folder"),
      newName: z.string().min(1).describe("New basename, without slashes"),
    }),
    reporter,
    label: ({ path, newName }) => `“${path}” → “${newName}”`,
    errorPrefix: "Error renaming file",
    run: async ({ path, newName }) => {
      await getConvexAdminClient().mutation(
        internal.agentFiles.agentRenameFileByPath,
        { projectId, path, newName },
      );
      return `Renamed "${path}" to "${newName}" successfully`;
    },
  });
