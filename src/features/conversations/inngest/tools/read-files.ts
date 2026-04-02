import { z } from "zod";
import { createTool } from "@inngest/agent-kit";
import { convex } from "@/lib/convex-client";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { MessageProgressReporter } from "../message-progress";

interface ReadFilesToolArgs {
  projectId: Id<"projects">;
  internalKey: string;
  reporter: MessageProgressReporter;
}

const paramsSchema = z
  .object({
    paths: z.array(z.string().min(1, "Path cannot be empty")),
    fileIds: z.array(z.string().min(1, "File ID cannot be empty")),
    format: z.enum(["full", "compact"]).default("compact"),
    maxChars: z.number().int().min(1).max(500_000).default(100_000),
    lineStart: z.number().int().min(1).optional(),
    lineEnd: z.number().int().min(1).optional(),
  })
  .refine(
    (data) =>
      data.paths.length > 0 || data.fileIds.length > 0,
    {
      message: "Provide at least one workspace-relative path or file id from listFiles",
    },
  );

type AgentReadRow = {
  status: "ok";
  path: string;
  id: Id<"files">;
  name: string;
  content: string;
  truncated?: boolean;
  totalChars?: number;
} | {
  status: "missing";
  path: string;
} | {
  status: "folder";
  path: string;
  id: Id<"files">;
  name: string;
} | {
  status: "binary";
  path: string;
  id: Id<"files">;
  name: string;
} | {
  status: "invalid_id";
  requestedId: string;
} | {
  status: "invalid_path";
  input: string;
  message: string;
};

function toCompactRow(row: AgentReadRow): unknown[] {
  switch (row.status) {
    case "ok":
      return [
        "o",
        row.path,
        row.id,
        row.name,
        row.content,
        row.truncated ?? false,
        row.totalChars ?? 0,
      ];
    case "missing":
      return ["m", row.path];
    case "folder":
      return ["f", row.path, row.id, row.name];
    case "binary":
      return ["b", row.path, row.id, row.name];
    case "invalid_id":
      return ["ii", row.requestedId];
    case "invalid_path":
      return ["ip", row.input, row.message];
  }
}

export const createReadFilesTool = ({
  projectId,
  internalKey,
  reporter,
}: ReadFilesToolArgs) => {
  return createTool({
    name: "readFiles",
    description:
      "Read text files by path (preferred) or file id. Default: compact output + maxChars cap. Use lineStart/lineEnd for partial reads.",
    parameters: z.object({
      paths: z
        .array(z.string())
        .describe("Workspace-relative paths from listFiles."),
      fileIds: z
        .array(z.string())
        .describe("Optional ids from listFiles if not using paths."),
      format: z
        .enum(["full", "compact"])
        .describe("compact: v=2 row table. full: one JSON object per line."),
      maxChars: z
        .number()
        .describe("Max characters returned per file after line slicing (default 100000)."),
      lineStart: z
        .number()
        .describe("1-based start line (optional)."),
      lineEnd: z
        .number()
        .describe("1-based end line inclusive (optional)."),
    }),
    handler: async (params, { step: toolStep }) => {
      const parsed = paramsSchema.safeParse(params);
      if (!parsed.success) {
        return `Error: ${parsed.error.issues[0]?.message ?? "Invalid parameters"}`;
      }
      const { paths, fileIds, format, maxChars, lineStart, lineEnd } =
        parsed.data;

      const hintParts: string[] = [];
      if (paths.length > 0) {
        hintParts.push(
          paths.length <= 2
            ? paths.join(", ")
            : `${paths.slice(0, 2).join(", ")} +${paths.length - 2} more`,
        );
      }
      if (fileIds.length > 0 && paths.length === 0) {
        hintParts.push(`${fileIds.length} id(s)`);
      }
      const detail = hintParts.length > 0 ? hintParts.join(" · ") : undefined;
      const progressId = await reporter.toolStart("readFiles", detail);

      try {
        const out = await toolStep?.run("read-files", async () => {
          const rows = (await convex.query(api.system.agentReadFiles, {
            internalKey,
            projectId,
            paths,
            fileIds,
            maxChars,
            lineStart,
            lineEnd,
          })) as AgentReadRow[];

          if (format === "compact") {
            return JSON.stringify({
              v: 2,
              legend:
                "o=ok(path,id,name,content,truncated,totalChars), m=missing, f=folder, b=binary, ii=invalid_id, ip=invalid_path",
              rows: rows.map(toCompactRow),
            });
          }

          const lines: string[] = [];
          for (const row of rows) {
            switch (row.status) {
              case "ok":
                lines.push(
                  JSON.stringify({
                    status: "ok",
                    path: row.path,
                    id: row.id,
                    name: row.name,
                    content: row.content,
                    ...(row.truncated
                      ? { truncated: true, totalChars: row.totalChars }
                      : {}),
                  }),
                );
                break;
              case "missing":
                lines.push(
                  JSON.stringify({
                    status: "missing",
                    path: row.path,
                  }),
                );
                break;
              case "folder":
                lines.push(
                  JSON.stringify({
                    status: "folder",
                    path: row.path,
                    id: row.id,
                    name: row.name,
                  }),
                );
                break;
              case "binary":
                lines.push(
                  JSON.stringify({
                    status: "binary",
                    path: row.path,
                    id: row.id,
                    name: row.name,
                  }),
                );
                break;
              case "invalid_id":
                lines.push(
                  JSON.stringify({
                    status: "invalid_id",
                    requestedId: row.requestedId,
                  }),
                );
                break;
              case "invalid_path":
                lines.push(
                  JSON.stringify({
                    status: "invalid_path",
                    input: row.input,
                    message: row.message,
                  }),
                );
                break;
            }
          }

          return lines.join("\n");
        });
        await reporter.toolEnd(progressId, true);
        return out ?? "";
      } catch (error) {
        await reporter.toolEnd(
          progressId,
          false,
          error instanceof Error ? error.message : "Unknown error",
        );
        return `Error: ${error instanceof Error ? error.message : "Unknown error"}`;
      }
    },
  });
};
