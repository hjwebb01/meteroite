import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const empty = path.join(mkdtempSync(path.join(tmpdir(), "comments-")), "suppressions.json");
writeFileSync(empty, "{}");

const run = spawnSync("npx", ["eslint", "-f", "json", "--suppressions-location", empty], { encoding: "utf8", maxBuffer: 1 << 28 });
const eslint = JSON.parse(run.stdout);

const rows = [];
for (const file of eslint) {
  const lines = readFileSync(file.filePath, "utf8").split("\n");
  for (const m of file.messages.filter((m) => m.ruleId === "local/no-comments")) {
    const text = lines.slice(m.line - 1, m.endLine).join("\n");
    rows.push({ file: path.relative(process.cwd(), file.filePath), line: m.line, endLine: m.endLine, text: text.trim(), next: (lines[m.endLine] ?? "").trim() });
  }
}

const css = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" || e.name.startsWith(".") ? [] : css(p);
    return e.name.endsWith(".css") ? [p] : [];
  });
for (const file of css("src")) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/\/\*[\s\S]*?\*\//g)) {
    const line = src.slice(0, m.index).split("\n").length;
    rows.push({ file, line, endLine: line + m[0].split("\n").length - 1, text: m[0], next: "" });
  }
}

for (const r of rows) console.log(`${r.file}:${r.line}-${r.endLine} | ${r.text.replace(/\s*\n\s*/g, " ").slice(0, 300)}${r.next ? `  ⟶ ${r.next.slice(0, 60)}` : ""}`);
console.error(`${rows.length} comment${rows.length === 1 ? "" : "s"} in the repo (directives excluded)`);
