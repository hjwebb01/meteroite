import { z } from "zod";
import { createTool } from "@inngest/agent-kit";
import { convex } from "@/lib/convex-client";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

interface ListFilesToolArgs {
  projectId: Id<"projects">;
  internalKey: string;
}

export const createListFilesTool = ({
  projectId,
  internalKey,
}: ListFilesToolArgs) => {
  return createTool({
    name: "listFiles",
    description:
      "List all files and folders in a project. Returns id, name, type, parentId, and path (workspace-relative) for each item. Items with parentId null are at root level. Use path when referring to locations; use id for readFile/updateFile/deleteFile.",
    parameters: z.object({}),
    handler: async (_, { step: toolStep }) => {
      try {
        return await toolStep?.run("list-files", async () => {
          const files = await convex.query(api.system.getProjectFilesWithPaths, {
            internalKey,
            projectId,
          });
          const sorted = files.toSorted((a, b) => {
            if (a.type !== b.type) {
              return a.type === "folder" ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
          });
          return JSON.stringify(sorted);
        });
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : "Unknown error"}`;
      }
    },
  });
};
