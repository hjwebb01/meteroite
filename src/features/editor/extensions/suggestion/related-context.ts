import { parser } from "@lezer/javascript";
import type { SyntaxNode } from "@lezer/common";

const SCRIPT_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
];
const RESOLVE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".d.ts",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
];

/** Related signatures are capped so large Projects keep requests fast. */
export const RELATED_CONTEXT_BUDGET_CHARS = 6_000;
const MAX_TYPE_DECLARATION_CHARS = 600;
const MAX_INITIALIZER_HEAD_CHARS = 60;

const scriptParser = parser.configure({ dialect: "ts jsx" });

export interface ProjectSourceFile {
  /** Workspace-relative path. */
  path: string;
  content: string;
}

export interface RelatedFile {
  path: string;
  signatures: string;
}

export interface ImportReference {
  specifier: string;
  /** Exported names the file uses; `*` means the whole module (namespace import or `export *`). */
  names: string[];
}

export interface ExportedSignature {
  name: string;
  isDefault: boolean;
  text: string;
}

export const isScriptPath = (path: string) =>
  SCRIPT_EXTENSIONS.some((extension) => path.endsWith(extension));

const children = (node: SyntaxNode) => {
  const result: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    result.push(child);
  }
  return result;
};

const unquote = (text: string) => text.slice(1, -1);

/** Names in `{ a, b as c }` as the exporting module calls them (`a`, `b`). */
const groupNames = (group: SyntaxNode, source: string) => {
  const names: string[] = [];
  const nodes = children(group);
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!/^(VariableDefinition|VariableName|PropertyName)$/.test(node.name)) {
      continue;
    }
    names.push(source.slice(node.from, node.to));
    if (nodes[i + 1]?.name === "as") i += 2;
  }
  return names;
};

export const parseImports = (source: string): ImportReference[] => {
  const tree = scriptParser.parse(source);
  const references: ImportReference[] = [];
  for (const statement of children(tree.topNode)) {
    if (
      statement.name !== "ImportDeclaration" &&
      statement.name !== "ExportDeclaration"
    ) {
      continue;
    }
    const nodes = children(statement);
    const from = nodes.findIndex((node) => node.name === "from");
    const specifierNode = nodes[from + 1];
    if (from === -1 || specifierNode?.name !== "String") continue;

    const names: string[] = [];
    for (const node of nodes.slice(0, from)) {
      if (node.name === "Star") names.push("*");
      else if (node.name === "VariableDefinition") {
        // `import def from` / `import * as ns from`: only a bare default binding names an export.
        if (nodes[nodes.indexOf(node) - 1]?.name !== "as")
          names.push("default");
      } else if (node.name === "ImportGroup" || node.name === "ExportGroup") {
        names.push(...groupNames(node, source));
      }
    }
    references.push({
      specifier: unquote(source.slice(specifierNode.from, specifierNode.to)),
      names,
    });
  }
  return references;
};

const normalize = (path: string) => {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0 && parts.at(-1) !== "..") parts.pop();
      else parts.push(part);
    } else parts.push(part);
  }
  return parts.join("/");
};

/** Resolves a relative specifier to a Project file path; bare package imports resolve to null. */
export const resolveRelativeImport = (
  fromPath: string,
  specifier: string,
  filePaths: ReadonlySet<string>,
): string | null => {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;
  const directory = fromPath.split("/").slice(0, -1).join("/");
  const base = normalize(`${directory}/${specifier}`);
  const candidates = [
    base,
    ...RESOLVE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...RESOLVE_EXTENSIONS.map((extension) => `${base}/index${extension}`),
  ];
  return candidates.find((candidate) => filePaths.has(candidate)) ?? null;
};

// Strip JSONC tokens without touching comment-like text inside strings.
const parseConfig = (source: string) => {
  const stringsAndComments = /"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\n\r]*/g;
  const withoutComments = source.replace(stringsAndComments, (token) =>
    token.startsWith('"') ? token : " ",
  );
  return JSON.parse(
    withoutComments.replace(
      /"(?:\\.|[^"\\])*"|,(\s*[}\]])/g,
      (token, closing: string | undefined) => closing ?? token,
    ),
  );
};

const aliasResolver = (
  files: ReadonlyMap<string, string>,
  fromPath: string,
) => {
  const configPath = [...files.keys()]
    .filter((path) => /(^|\/)(tsconfig|jsconfig)\.json$/.test(path))
    .filter((path) =>
      fromPath.startsWith(path.slice(0, path.lastIndexOf("/") + 1)),
    )
    .sort(
      (a, b) => b.split("/").length - a.split("/").length || a.localeCompare(b),
    )[0];
  if (!configPath) return () => null;
  try {
    const options = parseConfig(files.get(configPath)!).compilerOptions;
    if (
      typeof options?.baseUrl !== "string" ||
      !options.paths ||
      typeof options.paths !== "object"
    )
      return () => null;
    const directory = configPath.slice(0, configPath.lastIndexOf("/") + 1);
    const base = normalize(directory + options.baseUrl);
    const paths = new Set(files.keys());
    return (specifier: string): string | null => {
      const entries = Object.entries(options.paths).sort(
        ([a], [b]) =>
          Number(b === specifier) - Number(a === specifier) ||
          b.split("*")[0].length - a.split("*")[0].length,
      );
      for (const [pattern, targets] of entries) {
        const [prefix, suffix = ""] = pattern.split("*");
        const wildcard = pattern.includes("*");
        if (
          wildcard
            ? !specifier.startsWith(prefix) ||
              !specifier.endsWith(suffix) ||
              specifier.length < prefix.length + suffix.length
            : specifier !== pattern
        )
          continue;
        if (!Array.isArray(targets)) continue;
        const capture = wildcard
          ? specifier.slice(prefix.length, specifier.length - suffix.length)
          : "";
        for (const target of targets) {
          if (typeof target !== "string") continue;
          const resolved = resolveRelativeImport(
            "_root.ts",
            "./" + normalize(base + "/" + target.replace("*", capture)),
            paths,
          );
          if (resolved) return resolved;
        }
      }
      return null;
    };
  } catch {
    return () => null;
  }
};

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

const sliceBefore = (
  source: string,
  from: number,
  node: SyntaxNode | undefined,
) => oneLine(source.slice(from, node ? node.from : undefined));

const nameOf = (node: SyntaxNode, source: string) => {
  const definition = children(node).find(
    (child) =>
      child.name === "VariableDefinition" || child.name === "TypeDefinition",
  );
  return definition ? source.slice(definition.from, definition.to) : null;
};

const variableSignatures = (
  declaration: SyntaxNode,
  source: string,
  from: number,
): ExportedSignature[] => {
  const nodes = children(declaration);
  const signatures: ExportedSignature[] = [];
  nodes.forEach((node, index) => {
    if (node.name !== "VariableDefinition") return;
    const name = source.slice(node.from, node.to);
    const next = nodes[index + 1];
    const keyword = oneLine(source.slice(from, nodes[0].to));
    if (next?.name === "TypeAnnotation") {
      signatures.push({
        name,
        isDefault: false,
        text: `export ${keyword} ${name}${oneLine(source.slice(next.from, next.to))};`,
      });
      return;
    }
    const initializer = nodes[index + (next?.name === "Equals" ? 2 : 1)];
    let head = "";
    if (initializer && next?.name === "Equals") {
      const body = initializer.lastChild;
      const end = body?.name === "Block" ? body.from : initializer.to;
      head = oneLine(source.slice(initializer.from, end));
      if (head.length > MAX_INITIALIZER_HEAD_CHARS) {
        head = `${head.slice(0, MAX_INITIALIZER_HEAD_CHARS)}…`;
      }
    }
    signatures.push({
      name,
      isDefault: false,
      text: `export ${keyword} ${name}${head ? ` = ${head}` : ""};`,
    });
  });
  return signatures;
};

/** Top-level exported declarations as headers only; function and class bodies are never included. */
export const extractSignatures = (source: string): ExportedSignature[] => {
  const tree = scriptParser.parse(source);
  const signatures: ExportedSignature[] = [];
  for (const statement of children(tree.topNode)) {
    if (statement.name !== "ExportDeclaration") continue;
    const nodes = children(statement);
    const declaration = nodes.find((node) => /Declaration$/.test(node.name));
    if (!declaration) continue;
    const isDefault = nodes.some((node) => node.name === "default");
    const prefix = isDefault ? "export default " : "export ";

    if (declaration.name === "VariableDeclaration") {
      signatures.push(
        ...variableSignatures(declaration, source, declaration.from),
      );
      continue;
    }
    const name = nameOf(declaration, source);
    if (!name && !isDefault) continue;

    const body = children(declaration).find(
      (node) => node.name === "Block" || node.name === "ClassBody",
    );
    const full = oneLine(source.slice(declaration.from, declaration.to));
    let text: string;
    if (declaration.name === "FunctionDeclaration") {
      text = `${prefix}${sliceBefore(source, declaration.from, body)};`;
    } else if (declaration.name === "ClassDeclaration") {
      text = `${prefix}${sliceBefore(source, declaration.from, body)} { … }`;
    } else {
      // Type, interface and enum declarations are kept whole up to a cap, then reduced to the header.
      const header = oneLine(
        source.slice(
          declaration.from,
          children(declaration).find((n) =>
            /^(Equals|ObjectType|EnumBody)$/.test(n.name),
          )?.from,
        ),
      );
      text = `${prefix}${full.length <= MAX_TYPE_DECLARATION_CHARS ? full : header}`;
    }
    signatures.push({ name: name ?? "default", isDefault, text });
  }
  return signatures;
};

/**
 * Signatures from files the current file imports, within a character budget. Declarations of
 * symbols the file actually imports come first, then the remaining exports; anything that does
 * not fit is dropped whole.
 */
export const buildRelatedContext = ({
  path,
  source,
  files,
  budget = RELATED_CONTEXT_BUDGET_CHARS,
  openTabPaths = [],
}: {
  path: string;
  source: string;
  files: readonly ProjectSourceFile[];
  budget?: number;
  openTabPaths?: readonly string[];
}): RelatedFile[] => {
  if (!isScriptPath(path)) return [];
  const contentByPath = new Map(files.map((file) => [file.path, file.content]));
  const filePaths = new Set(contentByPath.keys());

  const resolveAlias = aliasResolver(contentByPath, path);
  const wanted = new Map<string, Set<string>>();
  for (const reference of parseImports(source)) {
    const resolved =
      resolveRelativeImport(path, reference.specifier, filePaths) ??
      resolveAlias(reference.specifier);
    if (!resolved || resolved === path || !isScriptPath(resolved)) continue;
    const names = wanted.get(resolved) ?? new Set<string>();
    reference.names.forEach((name) => names.add(name));
    wanted.set(resolved, names);
  }

  const candidates = [...wanted].map(([filePath, names]) => ({
    filePath,
    signatures: extractSignatures(contentByPath.get(filePath) ?? "").map(
      (signature) => ({
        signature,
        used:
          names.has(signature.name) ||
          (signature.isDefault && names.has("default")),
      }),
    ),
  }));

  const importedCount = candidates.length;
  for (const filePath of new Set(openTabPaths)) {
    if (filePath === path || wanted.has(filePath) || !isScriptPath(filePath))
      continue;
    candidates.push({
      filePath,
      signatures: extractSignatures(contentByPath.get(filePath) ?? "").map(
        (signature) => ({ signature, used: false }),
      ),
    });
  }

  let remaining = budget;
  const included = new Map<string, Set<ExportedSignature>>();
  for (const pass of [0, 1, 2]) {
    for (const [index, { filePath, signatures }] of candidates.entries()) {
      for (const { signature, used } of signatures) {
        if ((index >= importedCount ? 2 : used ? 0 : 1) !== pass) continue;
        const cost = signature.text.length + 1;
        if (cost > remaining) continue;
        remaining -= cost;
        const set = included.get(filePath) ?? new Set();
        set.add(signature);
        included.set(filePath, set);
      }
    }
  }

  return candidates.flatMap(({ filePath, signatures }) => {
    const kept = included.get(filePath);
    if (!kept) return [];
    return [
      {
        path: filePath,
        signatures: signatures
          .filter(({ signature }) => kept.has(signature))
          .map(({ signature }) => signature.text)
          .join("\n"),
      },
    ];
  });
};
