type ProjectFile = {
  _id: string;
  name: string;
  parentId?: string | null;
};

export function projectPaths<T extends ProjectFile>(
  files: readonly T[],
  options: { onOrphan?: "root" | "throw" } = {},
): {
  pathById: Map<T["_id"], string>;
  fileByPath: Map<string, T>;
  ancestorsById: Map<T["_id"], T[]>;
} {
  const byId = new Map<string, T>(files.map((file) => [file._id, file]));
  const pathById = new Map<T["_id"], string>();
  const fileByPath = new Map<string, T>();
  const ancestorsById = new Map<T["_id"], T[]>();

  const pathFor = (file: T, chain: Set<string>): string => {
    const cached = pathById.get(file._id);
    if (cached !== undefined) return cached;
    if (chain.has(file._id)) {
      throw new Error("Invalid file tree: cycle in parent chain");
    }
    chain.add(file._id);
    try {
      const parent = file.parentId ? byId.get(file.parentId) : undefined;
      if (file.parentId && !parent && options.onOrphan === "throw") {
        throw new Error("Invalid file tree: parent record not found");
      }
      // A missing parent makes the highest surviving ancestor a root.
      const parentPath = parent ? pathFor(parent, chain) : "";
      const path = parentPath ? `${parentPath}/${file.name}` : file.name;
      pathById.set(file._id, path);
      ancestorsById.set(file._id, [
        ...(parent ? ancestorsById.get(parent._id)! : []),
        file,
      ]);
      return path;
    } finally {
      chain.delete(file._id);
    }
  };

  for (const file of files) {
    fileByPath.set(pathFor(file, new Set()), file);
  }
  return { pathById, fileByPath, ancestorsById };
}
