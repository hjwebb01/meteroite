// Convex rejects deployed module paths containing characters other than
// letters, digits, underscores, and periods, but only at deploy time.
// Mirrors the CLI's entry-point rules (convex/dist/cli.bundle.cjs `entryPoints`)
// so `convex/lib/foo-bar.ts` fails here instead.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = "convex";
const EXTENSIONS = [".js", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"];
const VALID_COMPONENT = /^[A-Za-z0-9_.]+$/;

const isEntryPoint = (relPath) => {
  const base = path.basename(relPath);
  return (
    EXTENSIONS.some((ext) => base.endsWith(ext)) &&
    !relPath.startsWith(`_generated${path.sep}`) &&
    !base.startsWith(".") &&
    !base.startsWith("#") &&
    base !== "schema.ts" &&
    base !== "schema.js" &&
    // Multiple dots (foo.test.ts, auth.config.ts) are skipped by the CLI.
    (base.match(/\./g) ?? []).length <= 1 &&
    !relPath.includes(" ")
  );
};

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (!entry.isDirectory()) return [full];
    // Nested components are bundled separately.
    if (existsSync(path.join(full, "convex.config.ts"))) return [];
    return walk(full);
  });

const invalid = walk(ROOT)
  .map((file) => path.relative(ROOT, file))
  .filter(isEntryPoint)
  .filter((relPath) =>
    relPath
      .slice(0, -path.extname(relPath).length)
      .split(path.sep)
      .some((component) => !VALID_COMPONENT.test(component)),
  );

if (invalid.length > 0) {
  console.error(
    "Convex module paths may only contain letters, digits, underscores, and periods.\n" +
      "Rename these (e.g. foo-bar.ts -> foo_bar.ts) and update their imports:",
  );
  for (const relPath of invalid) console.error(`  ${path.join(ROOT, relPath)}`);
  process.exit(1);
}
