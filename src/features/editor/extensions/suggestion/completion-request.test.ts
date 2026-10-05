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
});
