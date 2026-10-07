import { spawn } from "node:child_process";
import {
  readdir,
  rm,
  lstat,
  mkdir,
  writeFile,
  readFile,
  readlink,
} from "node:fs/promises";
import { dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
import { createInterface } from "node:readline";
await exec("git", [
  "clone",
  "--no-hardlinks",
  "--no-checkout",
  "/input",
  "/work",
]);
const { stdout: pinnedSource } = await exec("git", [
  "--git-dir=/input",
  "rev-parse",
  "refs/heads/review",
]);
await exec("git", ["-C", "/work", "checkout", "--detach", pinnedSource.trim()]);
class SourceChanged extends Error {}
const { stdout: sourceTree } = await exec(
  "git",
  ["--git-dir=/input", "ls-tree", "-rz", "refs/heads/review"],
  { maxBuffer: 1000000 },
);
const baseline = new Map(
  sourceTree
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf("\t");
      const [mode, type, sha] = line.slice(0, tab).split(" ");
      return [line.slice(tab + 1), { mode, type, sha }];
    }),
);
if (baseline.size > 2000)
  throw new Error("Source inventory exceeds the runner limit");
const blobs = [...baseline.values()].filter((entry) => entry.type === "blob");
const batch = await new Promise((resolve, reject) => {
  const child = spawn("git", ["--git-dir=/input", "cat-file", "--batch"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let bytes = 0;
  const chunks = [];
  child.stdout.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > 11000000) {
      child.kill("SIGKILL");
      reject(new Error("Source contents exceed the runner limit"));
    } else chunks.push(chunk);
  });
  child.on("error", reject);
  child.on("close", (code) =>
    code === 0
      ? resolve(Buffer.concat(chunks))
      : reject(new Error("Could not load immutable source contents")),
  );
  child.stdin.on("error", reject);
  child.stdin.end(blobs.map((entry) => entry.sha).join("\n") + "\n");
});
let offset = 0;
for (const entry of blobs) {
  const end = batch.indexOf(10, offset);
  const [sha, type, sizeText] = batch
    .subarray(offset, end)
    .toString("utf8")
    .split(" ");
  const size = Number(sizeText);
  if (
    end < 0 ||
    sha !== entry.sha ||
    type !== "blob" ||
    !Number.isSafeInteger(size) ||
    size < 0 ||
    end + 1 + size >= batch.length
  )
    throw new Error("Invalid immutable source batch");
  entry.contents = batch.subarray(end + 1, end + 1 + size);
  offset = end + 2 + size;
}
const input = createInterface({ input: process.stdin });
for await (const line of input) {
  const { id, type, command, files } = JSON.parse(line);
  if (type === "verify") {
    try {
      const replacements = new Map(files.map((f) => [f.path, f.replacement]));
      const verifiedParents = new Set();
      for (const path of new Set([
        ...baseline.keys(),
        ...replacements.keys(),
      ])) {
        const old = baseline.get(path);
        if (old?.type !== "blob" && !replacements.has(path)) continue;
        const target = "/work/" + path;
        let parent = "/work";
        for (const part of path.split("/").slice(0, -1)) {
          parent += "/" + part;
          if (verifiedParents.has(parent)) continue;
          const info = await lstat(parent).catch((e) => {
            if (e.code === "ENOENT") return null;
            throw e;
          });
          verifiedParents.add(parent);
          if (!info?.isDirectory() || info.isSymbolicLink())
            throw new SourceChanged("Check changed a pinned parent directory");
        }
        const info = await lstat(target).catch((e) => {
          if (e.code === "ENOENT") return null;
          throw e;
        });
        const replacement = replacements.get(path);
        if (replacements.has(path) && replacement === null) {
          if (info)
            throw new SourceChanged("Check recreated a deleted proposal file");
          continue;
        }
        if (!info) throw new SourceChanged("Check deleted pinned source");
        if (old?.mode === "120000" && !replacements.has(path)) {
          if (
            !info.isSymbolicLink() ||
            (await readlink(target)) !== old.contents.toString("utf8")
          )
            throw new SourceChanged("Check changed a pinned symlink");
          continue;
        }
        if (
          !info.isFile() ||
          info.isSymbolicLink() ||
          Boolean(info.mode & 0o111) !== (old?.mode === "100755")
        )
          throw new SourceChanged("Check changed pinned file shape or mode");
        const expected = replacements.has(path)
          ? Buffer.from(replacement)
          : old.contents;
        if (info.size !== expected.length)
          throw new SourceChanged(
            "Check changed the proposed or pinned source size",
          );
        if (!(await readFile(target)).equals(expected))
          throw new SourceChanged(
            "Check changed the proposed or pinned source text",
          );
      }
      process.stdout.write(
        JSON.stringify({
          id,
          exitCode: 0,
          output: "Pinned source and proposal manifest unchanged",
        }) + "\n",
      );
    } catch (e) {
      process.stdout.write(
        JSON.stringify({
          id,
          exitCode: 1,
          output: e.message,
          sourceIntegrity:
            e instanceof SourceChanged ? "changed" : "unavailable",
        }) + "\n",
      );
    }
    continue;
  }
  if (type === "replace") {
    try {
      if (!Array.isArray(files) || files.length > 8)
        throw new Error("Unsupported proposal manifest");
      for (const entry of await readdir("/work"))
        await rm("/work/" + entry, { recursive: true, force: true });
      await exec("git", ["clone", "--no-hardlinks", "/input", "/work"]);
      const { stdout: source } = await exec("git", [
        "--git-dir=/input",
        "rev-parse",
        "refs/heads/review",
      ]);
      await exec("git", ["-C", "/work", "checkout", "--detach", source.trim()]);
      for (const file of files) {
        if (
          typeof file.path !== "string" ||
          !/^[A-Za-z0-9_.@/-]+$/.test(file.path) ||
          file.path.startsWith("/") ||
          file.path
            .split("/")
            .some(
              (p) =>
                !p || p === "." || p === ".." || p.toLowerCase() === ".git",
            ) ||
          (file.replacement !== null &&
            (typeof file.replacement !== "string" ||
              file.replacement.length > 100000 ||
              file.replacement.includes("\0")))
        )
          throw new Error("Unsupported proposal file");
        let current = "/work";
        for (const part of file.path.split("/")) {
          current += "/" + part;
          const info = await lstat(current).catch((e) => {
            if (e.code === "ENOENT") return null;
            throw e;
          });
          if (
            info?.isSymbolicLink() ||
            (current !== "/work/" + file.path && info && !info.isDirectory()) ||
            (current === "/work/" + file.path && info && !info.isFile())
          )
            throw new Error("Unsupported file shape");
        }
        const path = "/work/" + file.path;
        if (file.replacement === null) await rm(path);
        else {
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, file.replacement);
        }
      }
      process.stdout.write(
        JSON.stringify({
          id,
          exitCode: 0,
          output: "Canonical proposal materialized",
        }) + "\n",
      );
    } catch (e) {
      process.stdout.write(
        JSON.stringify({
          id,
          exitCode: 1,
          output: e.message,
          sourceIntegrity:
            e instanceof SourceChanged ? "changed" : "unavailable",
        }) + "\n",
      );
    }
    continue;
  }
  if (
    type !== "run" ||
    !Array.isArray(command) ||
    !["node", "npm", "git"].includes(command[0])
  ) {
    process.stdout.write(
      JSON.stringify({ id, exitCode: 1, output: "Unsupported command" }) + "\n",
    );
    continue;
  }
  const result = await new Promise((resolve) => {
    const child = spawn(
      "bwrap",
      [
        "--unshare-all",
        "--die-with-parent",
        "--new-session",
        "--clearenv",
        "--cap-drop",
        "ALL",
        "--ro-bind",
        "/usr",
        "/usr",
        "--ro-bind",
        "/bin",
        "/bin",
        "--ro-bind",
        "/lib",
        "/lib",
        "--ro-bind",
        "/lib64",
        "/lib64",
        "--ro-bind",
        "/runtime",
        "/runtime",
        "--bind",
        "/work",
        "/work",
        "--size",
        "67108864",
        "--tmpfs",
        "/tmp",
        "--proc",
        "/proc",
        "--dev",
        "/dev",
        "--setenv",
        "PATH",
        "/runtime/bin:/usr/bin",
        "--setenv",
        "HOME",
        "/tmp",
        "--setenv",
        "npm_config_offline",
        "true",
        "--chdir",
        "/work",
        "--",
        ...command,
      ],
      {
        cwd: "/work",
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      },
    );
    let output = "",
      clipped = false;
    const collect = (chunk) => {
      if (output.length + chunk.length > 64_000) {
        clipped = true;
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
      } else output += chunk.toString("utf8");
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (error) =>
      resolve({ exitCode: 1, output: error.message }),
    );
    child.on("close", (code) => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
      resolve({
        exitCode: code ?? 1,
        output: output + (clipped ? "\nOutput limit exceeded." : ""),
      });
    });
  });
  if (result.exitCode !== 0) {
    let manifest = {};
    try {
      manifest = JSON.parse(await readFile("/work/package.json", "utf8"));
    } catch {}
    const dependencies = Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.optionalDependencies,
    });
    const missing = result.output.match(
      /Cannot find (?:module|package) ['"]([^'"]+)['"]/,
    );
    const missingPackage =
      missing &&
      dependencies.find(
        (name) => missing[1] === name || missing[1].startsWith(name + "/"),
      );
    const missingInstallation =
      missingPackage &&
      /^(?:@[A-Za-z0-9_.-]+\/)?[A-Za-z0-9_.-]+$/.test(missingPackage) &&
      ![".", ".."].includes(missingPackage) &&
      !(await lstat("/work/node_modules/" + missingPackage).catch(() => null));
    if (
      missingInstallation ||
      /npm (?:error|ERR!) code ENOTCACHED/.test(result.output)
    )
      result.unavailableReason = missingInstallation
        ? `Dependency ${missingPackage} is not installed. This isolated runner has no preloaded dependencies or network access.`
        : "The offline npm cache cannot supply a required dependency. Network installation is unavailable.";
  }
  process.stdout.write(JSON.stringify({ id, ...result }) + "\n");
}
