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
      code: "a\nb\nconst x <|cursor|>= 1;\nd\ne",
    });
  });

  it("uses the last path segment as the file name", () => {
    expect(build("x", 1, "README.md")?.fileName).toBe("README.md");
  });

  it("windows at whole-line boundaries with truncation markers", () => {
    const lines = Array.from(
      { length: 200 },
      (_, i) => `const line${i} = ${i};`,
    );
    const source = lines.join("\n");
    const cursor = source.indexOf(lines[100]) + 6;
    const result = build(source, cursor)!;
    expect(result.code).toBe(
      [
        "[…]",
        ...lines.slice(40, 100),
        "const <|cursor|>line100 = 100;",
        ...lines.slice(101, 131),
        "[…]",
      ].join("\n"),
    );
  });

  it("shrinks the window to the character budget without splitting lines", () => {
    const lines = Array.from(
      { length: 200 },
      (_, i) => `${i}: ${"x".repeat(150)}`,
    );
    const source = lines.join("\n");
    const result = build(source, source.indexOf(lines[100]))!;
    expect(result.code.length).toBeLessThan(6030);
    for (const line of result.code.split("\n")) {
      if (line !== "[…]")
        expect(lines).toContain(line.replace("<|cursor|>", ""));
    }
  });

  it("keeps a long cursor line intact and handles start/end positions", () => {
    const source = "x".repeat(7000);
    expect(build(source, 0)?.code).toBe(`<|cursor|>${source}`);
    expect(build(source, source.length)?.code).toBe(`${source}<|cursor|>`);
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
        before: "const value = add(1, 2);",
        after: "const renamed = add(1, 2);",
      },
    ]);
  });
});
