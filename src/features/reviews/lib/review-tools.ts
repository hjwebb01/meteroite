import { z } from "zod";
import { ToolInputError } from "@/features/chatgpt/lib/tool-loop";
import type { createRepositoryReader, loadPullRequest } from "./github-context";

/**
 * SDK-independent contract for read-only review tools. Provider adapters
 * (AI SDK, ChatGPT Responses) derive their definitions from these fields and
 * dispatch calls through `execute`, which validates arguments first.
 */
export type ReviewToolCall = { callId: string; signal: AbortSignal };

/** Arguments the model can correct; adapters report it back instead of failing the run. */
export class ReviewToolInputError extends ToolInputError {}

export type ReviewTool = {
  name: string;
  description: string;
  parameters: z.ZodObject;
  execute: (args: unknown, call: ReviewToolCall) => Promise<unknown>;
};

export function defineReviewTool<Parameters extends z.ZodObject>({
  name,
  description,
  parameters,
  run,
}: {
  name: string;
  description: string;
  parameters: Parameters;
  run: (input: z.infer<Parameters>, call: ReviewToolCall) => Promise<unknown>;
}): ReviewTool {
  return {
    name,
    description,
    parameters,
    execute: async (args, call) => {
      const parsed = await parameters.safeParseAsync(args);
      if (!parsed.success)
        throw new ReviewToolInputError(z.prettifyError(parsed.error));
      return run(parsed.data, call);
    },
  };
}

export type Snapshot = Omit<
  Awaited<ReturnType<typeof loadPullRequest>>,
  "diffs"
>;
export type Reader = ReturnType<typeof createRepositoryReader>;

export function createRepositoryTools(
  snapshot: Snapshot,
  reader: Reader,
  checkActive: () => Promise<void>,
): ReviewTool[] {
  return [
    defineReviewTool({
      name: "getChangedLines",
      description:
        "Locate added RIGHT or removed LEFT line numbers in a changed file, including files whose patch was omitted. Returns at most 200 anchors; continue after lastLine when partial is true. These are locations, not source evidence.",
      parameters: z.object({
        path: z.string().max(500),
        side: z.enum(["LEFT", "RIGHT"]),
        startLine: z.number().int().positive(),
      }),
      run: async ({ path, side, startLine }) => {
        await checkActive();
        const file = snapshot.files.find((file) => file.filename === path);
        if (!file?.anchors)
          return {
            error: "Changed-line anchors are unavailable for this file.",
          };
        const anchors = file.anchors[side].filter((line) => line >= startLine);
        const lines = anchors.slice(0, 200);
        return {
          path,
          side,
          lines,
          lastLine: lines.at(-1),
          partial: anchors.length > 200,
        };
      },
    }),
    defineReviewTool({
      name: "listFiles",
      description:
        "Find repository files at the pinned head revision. Use prefixes to discover related code and tests.",
      parameters: z.object({ prefix: z.string().max(500) }),
      run: async ({ prefix }) => {
        await checkActive();
        const paths = snapshot.paths
          .filter((f) => f.path.startsWith(prefix))
          .map((f) => f.path);
        return {
          paths: paths.slice(0, 200),
          total: paths.length,
          truncated: paths.length > 200,
        };
      },
    }),
    defineReviewTool({
      name: "readFile",
      description:
        "Read numbered source lines at the pinned head commit. Read additional windows for long files. Already delivered lines are omitted and counted in alreadyRead; consult the earlier transcript for them.",
      parameters: z.object({
        path: z.string().max(500),
        startLine: z.number().int().positive(),
        endLine: z.number().int().positive(),
      }),
      run: ({ path, startLine, endLine }) =>
        reader.readFile(path, startLine, endLine),
    }),
    defineReviewTool({
      name: "searchText",
      description:
        "Search a literal symbol or phrase in a narrow repository path prefix. At most 25 files are scanned per call; results explain partial coverage. Already delivered lines are omitted and counted in alreadyRead; consult the earlier transcript for them.",
      parameters: z.object({
        query: z.string().min(2).max(120),
        pathPrefix: z.string().max(500),
      }),
      run: ({ query, pathPrefix }) => reader.searchText(query, pathPrefix),
    }),
  ];
}
