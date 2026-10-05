import { z } from "zod";
import { defineProjectTool } from "./define-project-tool";
import { getConvexAdminClient } from "@/lib/convex-client";
import { internal } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { MessageProgressReporter } from "../message-progress";

export const createDeleteFilesTool = ({
  projectId,
  reporter,
}: {
  projectId: Id<"projects">;
  reporter: MessageProgressReporter;
}) =>
  defineProjectTool({
    name: "deleteFiles",
    description:
      "Delete files or folders by workspace-relative paths. Folders are deleted recursively. Missing paths are safe retries.",
    parameters: z.object({
      paths: z
        .array(z.string().min(1))
        .min(1)
        .describe("Workspace-relative paths of files or folders to delete"),
    }),
    reporter,
    label: ({ paths }) => `${paths.length} item(s)`,
    errorPrefix: "Error deleting files",
    run: async ({ paths }) => {
      const results = await getConvexAdminClient().mutation(
        internal.agentFiles.agentDeleteFilesByPaths,
        { projectId, paths },
      );
      return results
        .map(({ path, alreadyMissing }) =>
          alreadyMissing
            ? `Path "${path}" is already deleted`
            : `Deleted "${path}" successfully`,
        )
        .join("\n");
    },
  });
