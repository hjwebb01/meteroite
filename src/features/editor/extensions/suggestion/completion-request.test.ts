import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { buildCompletionRequest } from "./completion-request";

const build = (source: string, cursor: number, path = "src/app/page.tsx") =>
  buildCompletionRequest({ doc: Text.of(source.split("\n")), cursor, path });

describe("buildCompletionRequest", () => {
  it("returns null for empty or whitespace-only documents", () => {
    expect(build("", 0)).toBeNull();
    expect(build("  \n ", 1)).toBeNull();
  });

  it("builds line context around the cursor for small files", () => {
    const source = "a\nb\nconst x = 1;\nd\ne";
    const cursor = source.indexOf("= 1");
    expect(build(source, cursor)).toEqual({
      fileName: "page.tsx",
      code: source,
      currentLine: "const x = 1;",
      previousLines: "a\nb\nconst x = 1;",
      textBeforeCursor: "const x ",
      textAfterCursor: "= 1;",
      nextLines: "d\ne",
      lineNumber: 3,
    });
  });

  it("uses the last path segment as the file name", () => {
    expect(build("x", 1, "README.md")?.fileName).toBe("README.md");
  });

  it("windows large files around the cursor", () => {
    const source = "x".repeat(30_000);
    const result = build(source, 15_000)!;
    expect(result.code.startsWith("[…]\n")).toBe(true);
    expect(result.code.endsWith("\n[…]")).toBe(true);
    expect(result.code.length).toBe(12_000 + "[…]\n".length + "\n[…]".length);
  });

  it("omits the head marker when the cursor is near the start", () => {
    const result = build("x".repeat(30_000), 100)!;
    expect(result.code.startsWith("[…]")).toBe(false);
    expect(result.code.endsWith("\n[…]")).toBe(true);
  });

  it("includes optional related files and recent edits when provided", () => {
    const source =
      'import { add } from "../lib/math";\nconst renamed = add(1, 2);';
    const result = buildCompletionRequest({
      doc: Text.of(source.split("\n")),
      cursor: source.length,
      path: "src/app/page.tsx",
      projectFiles: [
        {
          path: "src/lib/math.ts",
          content:
            "export function add(a: number, b: number): number { return a + b; }",
        },
      ],
      recentEdits: [
        {
          startLine: 2,
          endLine: 2,
          before: "const value = add(1, 2);",
          after: "const renamed = add(1, 2);",
        },
      ],
    });

    expect(result?.relatedFiles).toEqual([
      {
        path: "src/lib/math.ts",
        signatures: "export function add(a: number, b: number): number;",
      },
    ]);
    expect(result?.recentEdits).toEqual([
      {
        startLine: 2,
        endLine: 2,
        before: "const value = add(1, 2);",
        after: "const renamed = add(1, 2);",
      },
    ]);
  });
});
