import { describe, expect, it } from "vitest";
import {
  buildRelatedContext,
  extractSignatures,
  resolveRelativeImport,
} from "./related-context";

describe("resolveRelativeImport", () => {
  it("resolves standard extensions and index files, and ignores package imports", () => {
    const paths = new Set([
      "src/lib/math.ts",
      "src/shared/index.tsx",
      "src/lib/types.cts",
      "src/components/widgets/index.cjs",
      "src/app/node_modules/react/index.js",
    ]);

    expect(
      resolveRelativeImport("src/app/page.tsx", "../lib/math", paths),
    ).toBe("src/lib/math.ts");
    expect(resolveRelativeImport("src/app/page.tsx", "../shared", paths)).toBe(
      "src/shared/index.tsx",
    );
    expect(
      resolveRelativeImport("src/app/page.tsx", "../lib/types", paths),
    ).toBe("src/lib/types.cts");
    expect(
      resolveRelativeImport("src/app/page.tsx", "../components/widgets", paths),
    ).toBe("src/components/widgets/index.cjs");
    expect(
      resolveRelativeImport(
        "src/app/page.tsx",
        "../../../../src/lib/math",
        paths,
      ),
    ).toBeNull();
    expect(
      resolveRelativeImport("src/app/page.tsx", "react", paths),
    ).toBeNull();
  });
});

describe("extractSignatures", () => {
  it("keeps exported declaration shapes while omitting function and class bodies", () => {
    const source = [
      "export function add(left: number, right: number): number {",
      "  return left + right;",
      "}",
      "export class Widget extends BaseWidget {",
      '  render() { return "private implementation"; }',
      "}",
      "export const settings: { enabled: boolean } = { enabled: true };",
      "export const double = (value: number): number => {",
      "  return value * 2;",
      "};",
      "export const makeWidget = function (name: string) {",
      "  return name;",
      "};",
      "export interface Options { enabled: boolean; }",
      "export type Identifier = string;",
      'const privateValue = "not exported";',
    ].join("\n");

    const signatures = extractSignatures(source);

    expect(signatures.map(({ name }) => name)).toEqual([
      "add",
      "Widget",
      "settings",
      "double",
      "makeWidget",
      "Options",
      "Identifier",
    ]);
    const text = signatures.map(({ text: signature }) => signature).join("\n");
    expect(text).toContain(
      "export function add(left: number, right: number): number;",
    );
    expect(text).toContain("export class Widget extends BaseWidget { … }");
    expect(text).toContain("export const settings: { enabled: boolean };");
    expect(text).toContain("export const double = (value: number): number =>;");
    expect(text).toContain(
      "export const makeWidget = function (name: string);",
    );
    expect(text).toContain("export interface Options { enabled: boolean; }");
    expect(text).toContain("export type Identifier = string;");
    expect(text).not.toContain("private implementation");
    expect(text).not.toContain("left + right");
    expect(text).not.toContain("return name");
    expect(text).not.toContain("privateValue");
  });

  it("caps large type declarations at their header", () => {
    const source =
      'export interface Large { value: "' + "x".repeat(700) + '"; }';
    const [signature] = extractSignatures(source);

    expect(signature.text).toBe("export interface Large");
    expect(signature.text.length).toBeLessThan(600);
  });
});

describe("buildRelatedContext", () => {
  it("ignores bare imports and prioritizes imported signatures within the budget", () => {
    const context = buildRelatedContext({
      path: "src/app/page.tsx",
      source: [
        'import { wanted as localName } from "../lib/helpers";',
        'import "react";',
        "localName();",
      ].join("\n"),
      files: [
        {
          path: "src/lib/helpers.ts",
          content: [
            "export function other(value: string): void {}",
            "export function wanted(options: { enabled: boolean }): void {}",
          ].join("\n"),
        },
        {
          path: "src/app/node_modules/react/index.js",
          content: "export function createElement(): void {}",
        },
      ],
      // Enough for the imported declaration only, even though it follows another export.
      budget:
        "export function wanted(options: { enabled: boolean }): void;".length +
        1,
    });

    expect(context).toEqual([
      {
        path: "src/lib/helpers.ts",
        signatures:
          "export function wanted(options: { enabled: boolean }): void;",
      },
    ]);
  });

  it("does not add related context for non-JavaScript and non-TypeScript files", () => {
    expect(
      buildRelatedContext({
        path: "src/styles.css",
        source: '@import "./theme.css";',
        files: [{ path: "src/theme.css", content: ".root { color: red; }" }],
      }),
    ).toEqual([]);
  });
});

describe("alias and open-tab context", () => {
  const helper = {
    path: "src/lib/helper.ts",
    content: "export function helper(): void {}",
  };
  const tab = { path: "src/tab.ts", content: "export const tab = 1;" };
  const config = {
    path: "tsconfig.json",
    content:
      '{ // comment\n "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"], /* trailing comment */ }, }, }',
  };
  it("resolves JSONC aliases and does not duplicate imported open tabs", () => {
    expect(
      buildRelatedContext({
        path: "src/main.ts",
        source: 'import { helper } from "@/lib/helper";',
        files: [config, helper, tab],
        openTabPaths: [helper.path, tab.path, tab.path],
      }).map((file) => file.path),
    ).toEqual([helper.path, tab.path]);
  });
  it.each([undefined, { ...config, content: "{ broken" }])(
    "falls back to relative imports with invalid or missing config %s",
    (config) => {
      expect(
        buildRelatedContext({
          path: "src/main.ts",
          source:
            'import { helper } from "./lib/helper"; import { tab } from "@/tab";',
          files: [...(config ? [config] : []), helper, tab],
        }).map((file) => file.path),
      ).toEqual([helper.path]);
    },
  );
  it("gives all imported signatures priority over open tabs", () => {
    expect(
      buildRelatedContext({
        path: "src/main.ts",
        source: 'import { helper } from "./lib/helper";',
        files: [helper, tab],
        openTabPaths: [tab.path],
        budget: "export function helper(): void;".length + 1,
      }).map((file) => file.path),
    ).toEqual([helper.path]);
  });
});

it("resolves jsconfig exact aliases relative to baseUrl with target fallbacks", () => {
  expect(
    buildRelatedContext({
      path: "app/main.js",
      source: 'import { helper } from "helpers";',
      files: [
        {
          path: "app/jsconfig.json",
          content:
            '{"compilerOptions":{"baseUrl":"./lib","paths":{"helpers":["missing","helper"]}}}',
        },
        { path: "app/lib/helper.js", content: "export function helper() {}" },
      ],
    }).map((file) => file.path),
  ).toEqual(["app/lib/helper.js"]);
});
