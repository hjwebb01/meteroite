import { z } from "zod";
import { createTool } from "@inngest/agent-kit";
import { convex } from "@/lib/convex-client";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

interface ListFilesToolArgs {
  projectId: Id<"projects">;
  internalKey: string;
}

const paramsSchema = z.object({
  format: z.enum(["full", "compact"]).default("compact"),
  pathPrefix: z.string().default(""),
  limit: z.number().int().min(1).max(5000).default(500),
  cursor: z.number().int().min(0).default(0),
});

export const createListFilesTool = ({
  projectId,
  internalKey,
}: ListFilesToolArgs) => {
  return createTool({
    name: "listFiles",
    description:
      "List files/folders (paginated). Default: compact table + optional pathPrefix. Use pathPrefix (e.g. src) to avoid listing the whole repo.",
    parameters: z.object({
      format: z
        .enum(["full", "compact"])
        .describe(
          "compact: small token footprint (v=2 table). full: verbose JSON per file.",
        ),
      pathPrefix: z
        .string()
        .describe(
          "Only paths under this prefix (workspace-relative, no leading /). Empty = all.",
        ),
      limit: z
        .number()
        .describe("Max rows per page (1–5000). Default 500."),
      cursor: z
        .number()
        .describe("Offset for pagination. Default 0."),
    }),
    handler: async (params, { step: toolStep }) => {
      const parsed = paramsSchema.safeParse(params);
      if (!parsed.success) {
        return `Error: ${parsed.error.issues[0]?.message ?? "Invalid parameters"}`;
      }
      const { format, pathPrefix, limit, cursor } = parsed.data;

      try {
        return await toolStep?.run("list-files", async () => {
          const result = await convex.query(api.system.agentListProjectFiles, {
            internalKey,
            projectId,
            format,
            pathPrefix: pathPrefix || undefined,
            limit,
            cursor,
          });
          return JSON.stringify(result);
        });
      } catch (error) {
        return `Error: ${error instanceof Error ? error.message : "Unknown error"}`;
      }
    },
  });
};
