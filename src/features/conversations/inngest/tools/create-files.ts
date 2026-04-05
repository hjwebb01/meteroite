import { z } from "zod";
import { createTool } from "@inngest/agent-kit";

import { convex } from "@/lib/convex-client";

import { MAX_AGENT_CREATE_FILES_PER_MUTATION } from "../../../../../convex/agentLimits";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

import { normalizeGeneratedFileContent } from "../normalize-generated-file-content";
import type { MessageProgressReporter } from "../message-progress";

interface CreateFilesToolOptions {
  projectId: Id<"projects">;
  internalKey: string;
  reporter: MessageProgressReporter;
}

const fileEntrySchema = z.object({
  path: z
    .string()
    .min(1, "File path is required")
    .describe(
      "Workspace-relative file path (e.g. package.json or src/app.tsx). Parent folders are created automatically.",
    ),
  content: z
    .string()
    .describe(
      "Full file contents with exact formatting preserved. Use real line breaks, not literal \\n sequences.",
    ),
});

const paramsSchema = z.object({
  files: z
    .array(fileEntrySchema)
    .min(1, "Provide at least one file to create")
    .max(
      MAX_AGENT_CREATE_FILES_PER_MUTATION,
      `At most ${MAX_AGENT_CREATE_FILES_PER_MUTATION} files per call`,
    ),
});

export const createCreateFilesTool = ({
  projectId,
  internalKey,
  reporter,
}: CreateFilesToolOptions) => {
  return createTool({
    name: "createFiles",
    description:
      "Create one or more files at workspace-relative paths in a single call. Each file has its own path, so you can mix root files (e.g. package.json) and nested files (e.g. src/app.tsx). Missing folders are created automatically. Returns JSON array with path, fileId, or error per entry.",
    parameters: z.object({
      files: z
        .array(fileEntrySchema)
        .describe("Files to create, each with path and content"),
    }),
    handler: async (params, { step: toolStep }) => {
      const parsed = paramsSchema.safeParse(params);
      if (!parsed.success) {
        return `Error: ${parsed.error.issues[0]?.message ?? "Invalid parameters"}`;
      }

      const files = parsed.data.files.map((file) => ({
        ...file,
        content: normalizeGeneratedFileContent(file.content),
      }));

      const detail =
        files.length === 1
          ? files[0]!.path
          : `${files.length} files (${files[0]!.path}${files.length > 1 ? ", …" : ""})`;
      const progressId = await reporter.toolStart("createFiles", detail);

      try {
        const out = await toolStep?.run("create-files", async () => {
          const results = await convex.mutation(
            api.system.agentCreateFilesByPaths,
            {
              internalKey,
              projectId,
              files,
            },
          );
          return JSON.stringify(results);
        });
        await reporter.toolEnd(progressId, true);
        return out ?? "";
      } catch (error) {
        await reporter.toolEnd(
          progressId,
          false,
          error instanceof Error ? error.message : "Unknown error",
        );
        return `Error creating files: ${error instanceof Error ? error.message : "Unknown error"}`;
      }
    },
  });
};
