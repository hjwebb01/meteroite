import { z } from "zod";
import { defineProjectTool } from "./define-project-tool";
import { getConvexAdminClient } from "@/lib/convex-client";
import { internal } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { MessageProgressReporter } from "../message-progress";

export const createEditFileTool = ({
  projectId,
  reporter,
}: {
  projectId: Id<"projects">;
  reporter: MessageProgressReporter;
}) =>
  defineProjectTool({
    name: "editFile",
    description:
      "Apply one or more exact search/replace edits to a text file by path. Edits run in order, each search must match exactly once (include context to disambiguate). If any edit fails, nothing is written. Formatting is preserved literally.",
    parameters: z.object({
      path: z
        .string()
        .min(1)
        .describe("Workspace-relative path of the text file"),
      edits: z
        .array(
          z.object({
            search: z
              .string()
              .min(1)
              .describe(
                "Exact nonempty text to find, including whitespace and real line breaks",
              ),
            replace: z
              .string()
              .describe(
                "Literal replacement text; empty string deletes the matched text",
              ),
          }),
        )
        .min(1),
    }),
    reporter,
    label: ({ path }) => path,
    errorPrefix: "Error editing file",
    run: async ({ path, edits }) => {
      const result = await getConvexAdminClient().mutation(
        internal.agentFiles.agentEditFile,
        { projectId, path, edits },
      );
      return `File "${path}" edited successfully (${result.editsApplied} edit(s)).`;
    },
  });
