export type FileChangeAction =
  "created" | "updated" | "deleted" | "renamed" | "folder";

export interface FileChange {
  action: FileChangeAction;
  path: string;
  fileId?: string;
}

/** Matches Convex `messages.turnSummary`. */
export interface TurnSummary {
  filesRead: string[];
  filesChanged: FileChange[];
  findings: string[];
}

/** Structural subset of agent-kit's `ToolResultMessage` (avoids importing the SDK here). */
export interface ToolResultLike {
  tool: { name: string; input: Record<string, unknown> };
  content: unknown;
}

export interface AgentResultLike {
  toolCalls: ToolResultLike[];
}

export interface HistoryMessage {
  _id: string;
  role: "user" | "assistant";
  content: string;
  status?: "processing" | "completed" | "cancelled";
  turnSummary?: TurnSummary;
}

export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

const MAX_SUMMARY_FILES = 20;
const MAX_FINDINGS = 6;
const MAX_FINDING_LEN = 160;

/** Approximate chars-per-token ratio; avoids a tokenizer dependency. */
const CHARS_PER_TOKEN = 4;

export const HISTORY_TOKEN_BUDGET = 6_000;
/** No single past message may consume more than this share of the budget. */
export const HISTORY_MESSAGE_TOKEN_CAP = 1_500;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function toolOutput(content: unknown): { data?: string; error?: string } {
  if (typeof content === "string") {
    return { data: content };
  }
  if (content && typeof content === "object") {
    const { data, error } = content as { data?: unknown; error?: unknown };
    if (typeof data === "string") {
      return { data };
    }
    if (error !== undefined) {
      const message =
        typeof error === "object" && error && "message" in error
          ? String((error as { message: unknown }).message)
          : String(error);
      return { error: message };
    }
  }
  return {};
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

function pushUnique<T>(list: T[], item: T, key: (t: T) => string): void {
  if (!list.some((existing) => key(existing) === key(item))) {
    list.push(item);
  }
}

/** Collect `{path, id}` pairs and missing paths from readFiles output (compact v=2 or per-line JSON). */
function parseReadRows(data: string): {
  read: { path: string; id: string }[];
  missing: string[];
} {
  const read: { path: string; id: string }[] = [];
  const missing: string[] = [];
  const parsed = parseJson(data);
  if (parsed && typeof parsed === "object" && "rows" in parsed) {
    const rows = (parsed as { rows: unknown }).rows;
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!Array.isArray(row)) continue;
      if (row[0] === "o" && typeof row[1] === "string") {
        read.push({ path: row[1], id: String(row[2] ?? "") });
      } else if (row[0] === "m" && typeof row[1] === "string") {
        missing.push(row[1]);
      }
    }
    return { read, missing };
  }
  for (const line of data.split("\n")) {
    const row = parseJson(line) as
      { status?: string; path?: string; id?: string } | undefined;
    if (!row || typeof row.path !== "string") continue;
    if (row.status === "ok") {
      read.push({ path: row.path, id: String(row.id ?? "") });
    } else if (row.status === "missing") {
      missing.push(row.path);
    }
  }
  return { read, missing };
}

/** Learn `fileId -> path` from listFiles output (compact table or full rows). */
function parseListedPaths(data: string): [string, string][] {
  const parsed = parseJson(data);
  const pairs: [string, string][] = [];
  if (Array.isArray(parsed)) {
    for (const row of parsed as { id?: unknown; path?: unknown }[]) {
      if (typeof row?.id === "string" && typeof row.path === "string") {
        pairs.push([row.id, row.path]);
      }
    }
  } else if (parsed && typeof parsed === "object" && "rows" in parsed) {
    const rows = (parsed as { rows: unknown }).rows;
    for (const row of Array.isArray(rows) ? rows : []) {
      if (
        Array.isArray(row) &&
        typeof row[0] === "string" &&
        typeof row[2] === "string"
      ) {
        pairs.push([row[0], row[2]]);
      }
    }
  }
  return pairs;
}

function quotedName(text: string): string | undefined {
  return /"([^"]+)"/.exec(text)?.[1];
}

/**
 * Reduce one assistant turn's tool results to a compact, replayable record of
 * files touched. Paths are resolved from earlier reads/listings/creates in the
 * same turn for legacy id-based calls; current tools already receive paths.
 */
export function summarizeTurn(results: AgentResultLike[]): TurnSummary {
  const filesRead: string[] = [];
  const filesChanged: FileChange[] = [];
  const findings: string[] = [];
  const pathById = new Map<string, string>();

  const addFinding = (text: string) =>
    pushUnique(findings, clip(text, MAX_FINDING_LEN), (f) => f);
  const resolve = (fileId: string, fallback?: string) =>
    pathById.get(fileId) ?? fallback ?? fileId;

  for (const { toolCalls } of results) {
    for (const call of toolCalls) {
      const { name, input } = call.tool;
      const { data, error } = toolOutput(call.content);
      const failure = error ?? (data?.startsWith("Error") ? data : undefined);
      if (failure !== undefined) {
        addFinding(`${name} failed: ${failure}`);
        continue;
      }
      if (data === undefined) continue;

      switch (name) {
        case "listFiles":
          for (const [id, path] of parseListedPaths(data)) {
            pathById.set(id, path);
          }
          break;
        case "readFiles": {
          const { read, missing } = parseReadRows(data);
          for (const { path, id } of read) {
            pathById.set(id, path);
            pushUnique(filesRead, path, (p) => p);
          }
          for (const path of missing) {
            addFinding(`Not found: ${path}`);
          }
          break;
        }
        case "createFiles": {
          const rows = parseJson(data);
          for (const row of Array.isArray(rows) ? rows : []) {
            const {
              path,
              fileId,
              error: rowError,
            } = row as {
              path?: string;
              fileId?: string;
              error?: string;
            };
            if (typeof path !== "string") continue;
            if (rowError) {
              addFinding(`Could not create ${path}: ${rowError}`);
              continue;
            }
            if (fileId) pathById.set(fileId, path);
            filesChanged.push({ action: "created", path, fileId });
          }
          break;
        }
        case "createFolder": {
          const path = (parseJson(data) as { path?: unknown } | undefined)
            ?.path;
          if (typeof path === "string") {
            filesChanged.push({ action: "folder", path });
          }
          break;
        }
        case "editFile":
        case "updateFile": {
          const fileId =
            typeof input.fileId === "string" ? input.fileId : undefined;
          filesChanged.push({
            action: "updated",
            path:
              typeof input.path === "string"
                ? input.path
                : resolve(fileId ?? "", quotedName(data)),
            ...(fileId ? { fileId } : {}),
          });
          break;
        }
        case "renameFile": {
          const fileId =
            typeof input.fileId === "string" ? input.fileId : undefined;
          const oldPath =
            typeof input.path === "string"
              ? input.path
              : resolve(fileId ?? "", quotedName(data));
          const newName = String(input.newName ?? "");
          const slash = oldPath.lastIndexOf("/");
          const newPath =
            slash >= 0 ? `${oldPath.slice(0, slash + 1)}${newName}` : newName;
          if (fileId) pathById.set(fileId, newPath);
          filesChanged.push({
            action: "renamed",
            path: `${oldPath} → ${newPath}`,
            ...(fileId ? { fileId } : {}),
          });
          break;
        }
        case "deleteFiles": {
          for (const path of stringArray(input.paths)) {
            filesChanged.push({ action: "deleted", path });
          }
          for (const fileId of stringArray(input.fileIds)) {
            filesChanged.push({
              action: "deleted",
              path: resolve(fileId),
              fileId,
            });
          }
          break;
        }
        case "scrapeUrls":
          for (const url of stringArray(input.urls)) {
            addFinding(`Scraped ${url}`);
          }
          break;
      }
    }
  }

  // Later changes to the same file supersede earlier ones in the summary.
  const dedupedChanges: FileChange[] = [];
  for (const change of filesChanged) {
    const existing = dedupedChanges.findIndex(
      (c) => c.action === change.action && c.path === change.path,
    );
    if (existing >= 0) dedupedChanges.splice(existing, 1);
    dedupedChanges.push(change);
  }

  return {
    filesRead: filesRead.slice(0, MAX_SUMMARY_FILES),
    filesChanged: dedupedChanges.slice(-MAX_SUMMARY_FILES),
    findings: findings.slice(0, MAX_FINDINGS),
  };
}

export function isEmptySummary(summary: TurnSummary): boolean {
  return (
    summary.filesRead.length === 0 &&
    summary.filesChanged.length === 0 &&
    summary.findings.length === 0
  );
}

export function formatTurnSummary(summary: TurnSummary): string {
  const lines: string[] = [];
  if (summary.filesChanged.length > 0) {
    const changes = summary.filesChanged.map(
      (c) => `${c.action} ${c.path}${c.fileId ? ` (id ${c.fileId})` : ""}`,
    );
    lines.push(`Files changed: ${changes.join("; ")}`);
  }
  if (summary.filesRead.length > 0) {
    lines.push(`Files read: ${summary.filesRead.join(", ")}`);
  }
  if (summary.findings.length > 0) {
    lines.push(`Notes: ${summary.findings.join("; ")}`);
  }
  return lines.length > 0
    ? `[Tool activity in this turn — not shown to the user]\n${lines.join("\n")}`
    : "";
}

function renderMessage(message: HistoryMessage): HistoryTurn {
  const rawSummary =
    message.role === "assistant" && message.turnSummary
      ? formatTurnSummary(message.turnSummary)
      : "";
  const maxChars = HISTORY_MESSAGE_TOKEN_CAP * CHARS_PER_TOKEN;
  // Prioritize changed files, but cap even unusually long paths/legacy summaries
  // so the latest turn always fits the default budget.
  const summaryText = clip(rawSummary, maxChars - 202);
  const prose = clip(message.content, maxChars - summaryText.length - 2);
  return {
    role: message.role,
    content: summaryText ? `${prose}\n\n${summaryText}` : prose,
  };
}

/**
 * Select prior conversation turns (oldest → newest) that fit `tokenBudget`,
 * preferring the most recent. The in-flight assistant placeholder and the
 * current user message are excluded.
 */
export function selectHistoryTurns(
  messages: HistoryMessage[],
  options: {
    excludeIds: ReadonlySet<string>;
    tokenBudget?: number;
  },
): HistoryTurn[] {
  const budget = options.tokenBudget ?? HISTORY_TOKEN_BUDGET;
  const candidates = messages.filter(
    (m) =>
      !options.excludeIds.has(m._id) &&
      m.status !== "processing" &&
      m.status !== "cancelled" &&
      (m.content.trim() !== "" ||
        (m.role === "assistant" &&
          m.turnSummary !== undefined &&
          !isEmptySummary(m.turnSummary))),
  );

  const selected: HistoryTurn[] = [];
  let used = 0;
  for (let i = candidates.length - 1; i >= 0; i--) {
    const turn = renderMessage(candidates[i]!);
    const cost = estimateTokens(turn.content);
    if (used + cost > budget) {
      break;
    }
    used += cost;
    selected.unshift(turn);
  }
  return selected;
}

/**
 * Insert history turns directly after the leading system message(s).
 * Agent Kit places `State` messages after the current user input, so history is
 * spliced in from the `onStart` lifecycle instead. Idempotent across agent
 * iterations because the same turn objects are reused.
 */
export function withHistoryTurns<M extends { role: string }>(
  prompt: M[],
  historyTurns: M[],
): M[] {
  if (historyTurns.length === 0 || prompt.includes(historyTurns[0]!)) {
    return prompt;
  }
  const firstNonSystem = prompt.findIndex((m) => m.role !== "system");
  const at = firstNonSystem === -1 ? prompt.length : firstNonSystem;
  return [...prompt.slice(0, at), ...historyTurns, ...prompt.slice(at)];
}
