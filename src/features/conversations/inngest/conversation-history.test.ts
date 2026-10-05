// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  HISTORY_MESSAGE_TOKEN_CAP,
  estimateTokens,
  formatTurnSummary,
  isEmptySummary,
  selectHistoryTurns,
  summarizeTurn,
  withHistoryTurns,
  type AgentResultLike,
  type HistoryMessage,
} from "./conversation-history";

function call(
  name: string,
  input: Record<string, unknown>,
  data: string,
): AgentResultLike {
  return { toolCalls: [{ tool: { name, input }, content: { data } }] };
}

describe("summarizeTurn", () => {
  it("records current path-based mutations, including exact edits", () => {
    const summary = summarizeTurn([
      call(
        "updateFile",
        { path: "src/app.ts", content: "new" },
        'File "src/app.ts" updated successfully.',
      ),
      call(
        "editFile",
        { path: "src/style.css", edits: [{ search: "red", replace: "blue" }] },
        'File "src/style.css" edited successfully (1 edit(s)).',
      ),
      call(
        "renameFile",
        { path: "src/app.ts", newName: "main.ts" },
        'Renamed "src/app.ts" to "main.ts" successfully',
      ),
      call(
        "deleteFiles",
        { paths: ["src/old.ts"] },
        'Deleted "src/old.ts" successfully',
      ),
      call(
        "editFile",
        { path: "src/missing.ts" },
        "Error editing file: not found",
      ),
    ]);
    expect(summary.filesChanged).toEqual([
      { action: "updated", path: "src/app.ts" },
      { action: "updated", path: "src/style.css" },
      { action: "renamed", path: "src/app.ts → src/main.ts" },
      { action: "deleted", path: "src/old.ts" },
    ]);
    expect(summary.findings).toEqual([
      "editFile failed: Error editing file: not found",
    ]);
    const [followUp] = selectHistoryTurns(
      [
        {
          _id: "prior",
          role: "assistant",
          content: "Done.",
          status: "completed",
          turnSummary: summary,
        },
      ],
      { excludeIds: new Set() },
    );
    expect(followUp!.content).toContain("updated src/style.css");
    expect(followUp!.content).toContain("renamed src/app.ts → src/main.ts");
  });

  it("resolves the path of an updated file from a prior read", () => {
    const read = call(
      "readFiles",
      { paths: ["src/app.ts"] },
      JSON.stringify({
        v: 2,
        rows: [["o", "src/app.ts", "id1", "app.ts", "code", false, 4]],
      }),
    );
    const update = call(
      "updateFile",
      { fileId: "id1", content: "new" },
      'File "app.ts" updated successfully.',
    );
    expect(summarizeTurn([read, update])).toEqual({
      filesRead: ["src/app.ts"],
      filesChanged: [{ action: "updated", path: "src/app.ts", fileId: "id1" }],
      findings: [],
    });
  });

  it("falls back to the file name when the id was never listed", () => {
    const summary = summarizeTurn([
      call("updateFile", { fileId: "x" }, 'File "a.ts" updated successfully.'),
    ]);
    expect(summary.filesChanged).toEqual([
      { action: "updated", path: "a.ts", fileId: "x" },
    ]);
  });

  it("learns paths from listFiles for delete and rename", () => {
    const list = call(
      "listFiles",
      {},
      JSON.stringify({
        v: 2,
        cols: ["i", "t", "p", "r"],
        rows: [
          ["a", "f", "src/a.ts", null],
          ["b", "f", "src/b.ts", null],
        ],
      }),
    );
    const summary = summarizeTurn([
      list,
      call(
        "deleteFiles",
        { fileIds: ["a"] },
        'Deleted file "a.ts" successfully',
      ),
      call(
        "renameFile",
        { fileId: "b", newName: "c.ts" },
        'Renamed "b.ts" to "c.ts" successfully',
      ),
    ]);
    expect(summary.filesChanged).toEqual([
      { action: "deleted", path: "src/a.ts", fileId: "a" },
      { action: "renamed", path: "src/b.ts → src/c.ts", fileId: "b" },
    ]);
  });

  it("records created files, missing reads and tool failures as findings", () => {
    const summary = summarizeTurn([
      call(
        "createFiles",
        { files: [] },
        JSON.stringify([
          { path: "ok.ts", fileId: "n1" },
          { path: "bad.ts", error: "exists" },
        ]),
      ),
      call("readFiles", {}, JSON.stringify({ v: 2, rows: [["m", "gone.ts"]] })),
      call("updateFile", { fileId: "z" }, "Error: No file found"),
    ]);
    expect(summary.filesChanged).toEqual([
      { action: "created", path: "ok.ts", fileId: "n1" },
    ]);
    expect(summary.findings).toEqual([
      "Could not create bad.ts: exists",
      "Not found: gone.ts",
      "updateFile failed: Error: No file found",
    ]);
  });

  it("keeps summaries bounded", () => {
    const rows = Array.from({ length: 100 }, (_, i) => [
      "o",
      `f${i}.ts`,
      `id${i}`,
      `f${i}.ts`,
      "",
      false,
      0,
    ]);
    const summary = summarizeTurn([
      call("readFiles", {}, JSON.stringify({ v: 2, rows })),
    ]);
    expect(summary.filesRead).toHaveLength(20);
  });

  it("is empty when only non-file tools ran", () => {
    expect(isEmptySummary(summarizeTurn([]))).toBe(true);
    expect(formatTurnSummary(summarizeTurn([]))).toBe("");
  });
});

function msg(
  id: string,
  role: "user" | "assistant",
  content: string,
  extra: Partial<HistoryMessage> = {},
): HistoryMessage {
  return { _id: id, role, content, status: "completed", ...extra };
}

describe("selectHistoryTurns", () => {
  it("keeps the newest turns that fit the token budget, in order", () => {
    const messages = [
      msg("1", "user", "a".repeat(400)),
      msg("2", "assistant", "b".repeat(400)),
      msg("3", "user", "c".repeat(400)),
      msg("4", "assistant", "d".repeat(400)),
    ];
    const turns = selectHistoryTurns(messages, {
      excludeIds: new Set(),
      tokenBudget: 250,
    });
    expect(turns.map((t) => t.content[0])).toEqual(["c", "d"]);
  });

  it("is not limited to a fixed message count", () => {
    const messages = Array.from({ length: 12 }, (_, i) =>
      msg(String(i), i % 2 ? "assistant" : "user", `m${i}`),
    );
    expect(
      selectHistoryTurns(messages, { excludeIds: new Set() }),
    ).toHaveLength(12);
  });

  it("excludes the current turn, placeholders and empty messages", () => {
    const messages = [
      msg("1", "user", "old"),
      msg("2", "assistant", "   "),
      msg("3", "user", "current"),
      msg("4", "assistant", "", { status: "processing" }),
      msg("5", "assistant", "partial", { status: "processing" }),
    ];
    const turns = selectHistoryTurns(messages, {
      excludeIds: new Set(["3", "4"]),
    });
    expect(turns).toEqual([{ role: "user", content: "old" }]);
  });

  it("bounds one huge message and preserves its tool summary", () => {
    const summary = {
      filesRead: ["src/app.ts"],
      filesChanged: [
        { action: "updated" as const, path: "src/app.ts", fileId: "id1" },
      ],
      findings: [],
    };
    const [turn] = selectHistoryTurns(
      [msg("1", "assistant", "x".repeat(200_000), { turnSummary: summary })],
      { excludeIds: new Set() },
    );
    expect(estimateTokens(turn!.content)).toBeLessThanOrEqual(
      HISTORY_MESSAGE_TOKEN_CAP + 5,
    );
    expect(turn!.content).toContain("updated src/app.ts (id id1)");
  });

  it("ignores summaries on user messages", () => {
    const [turn] = selectHistoryTurns(
      [
        msg("1", "user", "hi", {
          turnSummary: { filesRead: ["a"], filesChanged: [], findings: [] },
        }),
      ],
      { excludeIds: new Set() },
    );
    expect(turn!.content).toBe("hi");
  });

  it("keeps an oversized latest summary within the message budget", () => {
    const [turn] = selectHistoryTurns(
      [
        msg("1", "assistant", "done", {
          turnSummary: {
            filesChanged: [
              { action: "updated", path: "src/app.ts", fileId: "id1" },
            ],
            filesRead: ["x".repeat(100_000)],
            findings: [],
          },
        }),
      ],
      { excludeIds: new Set() },
    );
    expect(estimateTokens(turn!.content)).toBeLessThanOrEqual(
      HISTORY_MESSAGE_TOKEN_CAP,
    );
    expect(turn!.content).toContain("updated src/app.ts (id id1)");
  });

  it("replays summary-only completed turns but excludes cancelled ones", () => {
    const turnSummary = {
      filesRead: ["src/app.ts"],
      filesChanged: [],
      findings: [],
    };
    const turns = selectHistoryTurns(
      [
        msg("1", "assistant", "", { turnSummary }),
        msg("2", "assistant", "aborted", { turnSummary, status: "cancelled" }),
      ],
      { excludeIds: new Set() },
    );
    expect(turns).toHaveLength(1);
    expect(turns[0]!.content).toContain("src/app.ts");
  });
});

describe("withHistoryTurns", () => {
  const system = { role: "system", content: "sys" };
  const user = { role: "user", content: "now" };
  const history = [
    { role: "user", content: "before" },
    { role: "assistant", content: "reply" },
  ];

  it("places history between the system prompt and the current message", () => {
    expect(withHistoryTurns([system, user], history)).toEqual([
      system,
      ...history,
      user,
    ]);
  });

  it("is idempotent across agent iterations", () => {
    const once = withHistoryTurns([system, user], history);
    expect(withHistoryTurns(once, history)).toBe(once);
  });

  it("leaves the prompt alone without history", () => {
    const prompt = [system, user];
    expect(withHistoryTurns(prompt, [])).toBe(prompt);
  });
});
