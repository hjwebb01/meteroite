import { z } from "zod";
import { defineProjectTool } from "./define-project-tool";
import { getConvexAdminClient } from "@/lib/convex-client";
import { internal } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { MessageProgressReporter } from "../message-progress";
import { normalizeGeneratedFileContent } from "../normalize-generated-file-content";

export const createUpdateFileTool = ({
  projectId,
  reporter,
}: {
  projectId: Id<"projects">;
  reporter: MessageProgressReporter;
}) =>
  defineProjectTool({
    name: "updateFile",
    description:
      "Replace the entire content of a text file by workspace-relative path. Prefer editFile for small changes to existing files.",
    parameters: z.object({
      path: z
        .string()
        .min(1)
        .describe("Workspace-relative path of the file to update"),
      content: z
        .string()
        .describe(
          "Complete new content with real line breaks and exact formatting",
        ),
    }),
    reporter,
    label: ({ path }) => path,
    errorPrefix: "Error updating file",
    run: async ({ path, content }) => {
      await getConvexAdminClient().mutation(
        internal.agentFiles.agentUpdateFileByPath,
        {
          projectId,
          path,
          content: normalizeGeneratedFileContent(content),
        },
      );
      return `File "${path}" updated successfully.`;
    },
  });
