import { describe, expect, test } from "vitest";
import { projectPaths } from "./project-paths";

describe("projectPaths", () => {
  test("resolves nested paths even when children precede parents", () => {
    const files = [
      { _id: "file", name: "app.ts", parentId: "nested", content: "source" },
      { _id: "nested", name: "components", parentId: "root" },
      { _id: "root", name: "src" },
    ];
    const { pathById, fileByPath } = projectPaths(files);
    expect(pathById.get("root")).toBe("src");
    expect(pathById.get("nested")).toBe("src/components");
    expect(pathById.get("file")).toBe("src/components/app.ts");
    expect(fileByPath.get("src/components/app.ts")).toBe(files[0]);
    expect(fileByPath.get("src/components")).toBe(files[1]);
  });

  test("treats an orphan as a root and keeps its descendants", () => {
    const files = [
      { _id: "child", name: "app.ts", parentId: "orphan" },
      { _id: "orphan", name: "src", parentId: "missing" },
    ];
    const { pathById, fileByPath } = projectPaths(files);
    expect([...pathById.entries()]).toEqual([
      ["orphan", "src"],
      ["child", "src/app.ts"],
    ]);
    expect(fileByPath.get("src")).toBe(files[1]);
    expect(fileByPath.get("src/app.ts")).toBe(files[0]);
    expect(pathById.has("missing")).toBe(false);
  });

  test("uses root names without a leading slash", () => {
    const files = [
      { _id: "package", name: "package.json" },
      { _id: "readme", name: "README.md", parentId: null },
    ];
    const { pathById, fileByPath } = projectPaths(files);
    expect([...pathById.values()]).toEqual(["package.json", "README.md"]);
    expect([...fileByPath.values()]).toEqual(files);
  });

  test("returns empty maps for an empty project", () => {
    const { pathById, fileByPath } = projectPaths([]);
    expect(pathById.size).toBe(0);
    expect(fileByPath.size).toBe(0);
  });

  test("rejects cycles in parent chains", () => {
    expect(() => projectPaths([
      { _id: "a", name: "a", parentId: "b" },
      { _id: "b", name: "b", parentId: "a" },
    ])).toThrow("Invalid file tree: cycle in parent chain");
  });
});
