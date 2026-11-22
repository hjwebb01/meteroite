import { z } from "zod";
import { ToolInputError } from "@/features/chatgpt/lib/tool-loop";
import type { createRepositoryReader, loadPullRequest } from "./github-context";

const MAX_LISTED_PATHS = 50;
const MAX_ACTION_LENGTH = 120;
const MAX_PATH_LENGTH = 500;

export type ReviewToolCall = { callId: string; signal: AbortSignal };

class ReviewToolInputError extends ToolInputError {}

type ReviewActionDescription = {
  text: string;
  path?: string;
  start?: number;
  end?: number;
};

type ReviewCallObserver = (
  tool: string,
  description: ReviewActionDescription,
) => Promise<void> | void;

export type ReviewTool = {
  name: string;
  description: string;
  parameters: z.ZodObject;
  describe: (args: unknown) => ReviewActionDescription;
  execute: (args: unknown, call: ReviewToolCall) => Promise<unknown>;
};

function summarizeAction({
  text,
  path,
  start,
  end,
}: ReviewActionDescription): ReviewActionDescription {
  const oneLine = text.replace(/\p{Cc}+/gu, " ").trim();
  const safePath = path && path.length <= MAX_PATH_LENGTH ? path : undefined;
  return {
    text:
      oneLine.length > MAX_ACTION_LENGTH
        ? `${oneLine.slice(0, MAX_ACTION_LENGTH - 1)}…`
        : oneLine,
    ...(safePath ? { path: safePath } : {}),
    ...(safePath && start !== undefined && end !== undefined
      ? { start, end }
      : {}),
  };
}

export function defineReviewTool<Parameters extends z.ZodObject>(
  {
    name,
    description,
    parameters,
    describe = () => ({ text: `Running ${name}` }),
    run,
  }: {
    name: string;
    description: string;
    parameters: Parameters;
    describe?: (input: z.infer<Parameters>) => ReviewActionDescription;
    run: (input: z.infer<Parameters>, call: ReviewToolCall) => Promise<unknown>;
  },
  onCall?: ReviewCallObserver,
): ReviewTool {
  return {
    name,
    description,
    parameters,
    describe: (args) => {
      const parsed = parameters.safeParse(args);
      return parsed.success
        ? summarizeAction(describe(parsed.data))
        : { text: `Running ${name}` };
    },
    execute: async (args, call) => {
      const parsed = await parameters.safeParseAsync(args);
      if (!parsed.success)
        throw new ReviewToolInputError(z.prettifyError(parsed.error));
      await onCall?.(name, summarizeAction(describe(parsed.data)));
      return run(parsed.data, call);
    },
  };
}

export type Snapshot = Omit<
  Awaited<ReturnType<typeof loadPullRequest>>,
  "diffs"
>;
type Reader = ReturnType<typeof createRepositoryReader>;

const orDefault = (value: string, fallback: string) =>
  value.trim() ? value : fallback;

export function createRepositoryTools(
  snapshot: Snapshot,
  reader: Reader,
  checkActive: () => Promise<void>,
  onCall?: ReviewCallObserver,
): ReviewTool[] {
  return [
    defineReviewTool(
      {
        name: "getChangedLines",
        description:
          "Locate added RIGHT or removed LEFT line numbers in a changed file, including files whose patch was omitted. Returns at most 200 anchors; continue after lastLine when partial is true. These are locations, not source evidence.",
        parameters: z.object({
          path: z.string().max(500),
          side: z.enum(["LEFT", "RIGHT"]),
          startLine: z.number().int().positive(),
        }),
        describe: ({ path }) => ({
          text: `Checking changed lines in ${orDefault(path, "a file")}`,
          path,
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
      },
      onCall,
    ),
    defineReviewTool(
      {
        name: "listFiles",
        description:
          "Find repository files at the pinned head revision. Use prefixes to discover related code and tests. Returns at most 50 paths; continue with nextCursor when partial is true. Cursor is a zero-based offset into the pinned, prefix-filtered path list.",
        parameters: z.object({
          prefix: z.string().max(500),
          cursor: z.number().int().nonnegative().optional(),
        }),
        describe: ({ prefix }) => ({
          text: `Listing ${orDefault(prefix, "the repository")}`,
          path: prefix,
        }),
        run: async ({ prefix, cursor = 0 }) => {
          await checkActive();
          const paths = snapshot.paths
            .filter((f) => f.path.startsWith(prefix))
            .map((f) => f.path);
          const page = paths.slice(cursor, cursor + MAX_LISTED_PATHS);
          const nextCursor =
            cursor + page.length < paths.length ? cursor + page.length : null;
          return {
            paths: page,
            total: paths.length,
            partial: nextCursor !== null,
            nextCursor,
          };
        },
      },
      onCall,
    ),
    defineReviewTool(
      {
        name: "readFile",
        description:
          "Read numbered source lines at the pinned head commit. Read additional windows for long files. Already delivered lines are omitted and counted in alreadyRead; consult the diff or earlier transcript for them. Empty content with alreadyRead means the requested lines were already supplied, not unavailable.",
        parameters: z.object({
          path: z.string().max(500),
          startLine: z.number().int().positive(),
          endLine: z.number().int().positive(),
        }),
        describe: ({ path, startLine, endLine }) => ({
          text: `Reading ${orDefault(path, "a file")}`,
          path,
          start: startLine,
          end: endLine,
        }),
        run: ({ path, startLine, endLine }) =>
          reader.readFile(path, startLine, endLine),
      },
      onCall,
    ),
    defineReviewTool(
      {
        name: "searchText",
        description:
          "Search a literal symbol or phrase in a narrow repository path prefix. At most 25 files are scanned and 20 new matches are returned per call; continue with the returned nextCursor when partial is true. Cursor fileOffset and lineOffset are zero-based offsets in the pinned, prefix- and size-filtered path list and current file. Already delivered lines are omitted and counted in alreadyRead; consult the earlier transcript for them.",
        parameters: z.object({
          query: z.string().min(2).max(120),
          pathPrefix: z.string().max(500),
          cursor: z
            .object({
              fileOffset: z.number().int().nonnegative(),
              lineOffset: z.number().int().nonnegative(),
            })
            .optional(),
        }),
        describe: ({ pathPrefix }) => ({
          text: `Searching ${orDefault(pathPrefix, "the repository")}`,
          path: pathPrefix,
        }),
        run: ({ query, pathPrefix, cursor }) =>
          reader.searchText(query, pathPrefix, cursor),
      },
      onCall,
    ),
  ];
}
