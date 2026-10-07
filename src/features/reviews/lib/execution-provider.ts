import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  readdir,
  writeFile,
  readFile,
  rm,
  realpath,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { FindingStopped } from "./finding-stop";
import { randomUUID } from "node:crypto";
const exec = promisify(execFile);
export class SourceVerificationError extends Error {
  constructor(
    readonly kind: "changed" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "SourceVerificationError";
  }
}
export type ExecutionCheck = {
  command: string[];
  status: "passed" | "failed" | "unavailable";
  exitCode?: number;
  output: string;
  sourceSha: string;
  sourceIntegrity?: "changed" | "unavailable";
};
type ProposalFiles = Array<{ path: string; replacement: string | null }>;
export type IsolatedRepository = {
  sourceSha: string;
  executionUnit: string;
  directory: string;
  run(command: string[], signal: AbortSignal): Promise<ExecutionCheck>;
  replaceFiles(files: ProposalFiles, signal: AbortSignal): Promise<void>;
  verifyFiles(files: ProposalFiles, signal: AbortSignal): Promise<void>;
  stop(): Promise<void>;
};
const properties = [
  "MemoryMax=1073741824",
  "MemorySwapMax=0",
  "TasksMax=64",
  "CPUQuota=100%",
  "KillMode=control-group",
  "TimeoutStopSec=2",
  "NoNewPrivileges=yes",
];

export type ExecutionCapability = { available: boolean; reason: string };
const CAPABILITY_TTL_MS = 60_000;
let cachedCapability: { value: ExecutionCapability; expiresAt: number } | null =
  null;

// Probing starts a systemd unit, so share one result across requests.
export async function executionCapability(): Promise<ExecutionCapability> {
  if (cachedCapability && cachedCapability.expiresAt > Date.now())
    return cachedCapability.value;
  const value = await probeExecutionCapability();
  cachedCapability = { value, expiresAt: Date.now() + CAPABILITY_TTL_MS };
  return value;
}

async function probeExecutionCapability(): Promise<ExecutionCapability> {
  if (process.platform !== "linux")
    return {
      available: false,
      reason:
        "Execution needs a Linux runner with Bubblewrap and a delegated systemd user service.",
    };
  try {
    const node = await realpath(process.execPath);
    await exec("bwrap", ["--version"], { timeout: 2000 });
    const script =
      'const fs=require("fs");const p="/sys/fs/cgroup"+fs.readFileSync("/proc/self/cgroup","utf8").trim().split(":").pop();console.log(JSON.stringify(["memory.max","pids.max","cpu.max"].map(n=>fs.readFileSync(p+"/"+n,"utf8").trim())))';
    const { stdout } = await exec(
      "systemd-run",
      [
        "--user",
        "--wait",
        "--pipe",
        "--collect",
        "--quiet",
        ...properties.flatMap((p) => ["-p", p]),
        "-p",
        "RuntimeMaxSec=5",
        node,
        "-e",
        script,
      ],
      { timeout: 7000 },
    );
    const values = JSON.parse(stdout.trim());
    if (
      values[0] !== "1073741824" ||
      values[1] !== "64" ||
      values[2] !== "100000 100000"
    )
      throw new Error("Aggregate resource limits were not applied");
    return {
      available: true,
      reason:
        "Offline Node.js checkout in Bubblewrap. One GiB memory, 64 processes, one CPU. Dependencies requiring network or secrets are unavailable.",
    };
  } catch {
    return {
      available: false,
      reason:
        "Bubblewrap or enforced aggregate systemd limits are unavailable on this worker. Static discussion remains available.",
    };
  }
}

export function githubRepositoryUrl(owner: string, repo: string) {
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}.git`;
}

type ControllerRequest =
  | { type: "run"; command: string[] }
  | { type: "replace" | "verify"; files: ProposalFiles };

export async function openIsolatedRepository(input: {
  sourceSha: string;
  repositoryUrl: string;
  githubToken: string;
  deadline: number;
  signal: AbortSignal;
}): Promise<IsolatedRepository> {
  if (!(await executionCapability()).available)
    throw new Error("Isolated execution is unavailable on this worker");
  const directory = await mkdtemp(join(tmpdir(), "meteroite-review-"));
  const source = join(directory, "source.git");
  const node = await realpath(process.execPath);
  const runtime = dirname(dirname(node));
  const unit = `meteroite-review-${randomUUID()}.service`;
  let stopped = false;
  let ended = false;
  let child: ReturnType<typeof spawn> | undefined;
  const waiting = new Map<
    string,
    {
      resolve: (result: ExecutionCheck) => void;
      reject: (error: Error) => void;
      command: string[];
    }
  >();
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await exec("systemctl", ["--user", "stop", unit], { timeout: 4000 }).catch(
      () => {},
    );
    child?.kill("SIGKILL");
    for (const pending of waiting.values())
      pending.reject(new Error("Execution stopped"));
    waiting.clear();
    await rm(directory, { recursive: true, force: true });
  };
  const request = async (
    message: ControllerRequest,
    signal: AbortSignal,
  ): Promise<ExecutionCheck> => {
    if (ended) throw new Error("The isolated command service is unavailable");
    if (stopped || signal.aborted)
      throw new FindingStopped("cancelled", "Execution cancelled");
    if (Date.now() >= input.deadline)
      throw new FindingStopped("time-limit", "Execution deadline reached");
    const command = message.type === "run" ? message.command : [];
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const abort = () => {
        void stop();
        reject(new Error("Execution cancelled"));
      };
      signal.addEventListener("abort", abort, { once: true });
      waiting.set(id, {
        command,
        reject: (error) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
        resolve: (result) => {
          signal.removeEventListener("abort", abort);
          resolve(result);
        },
      });
      child?.stdin?.write(JSON.stringify({ id, ...message }) + "\n");
    });
  };
  const run = async (command: string[], signal: AbortSignal) => {
    if (
      !command.length ||
      command.length > 20 ||
      command.some((x) => x.length > 2000) ||
      !["node", "npm", "git"].includes(command[0])
    )
      return {
        command,
        status: "unavailable" as const,
        output: "Only the offline Node.js, npm and Git toolchain is available.",
        sourceSha: input.sourceSha,
      };
    return request({ type: "run", command }, signal);
  };
  try {
    await writeFile(
      join(directory, "source.json"),
      JSON.stringify({ sourceSha: input.sourceSha, deadline: input.deadline }),
    );
    await exec("git", ["init", "--bare", source], {
      timeout: 5000,
      signal: input.signal,
    });
    const env = {
      PATH: process.env.PATH,
      NODE_ENV: process.env.NODE_ENV,
      HOME: directory,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${input.githubToken}`).toString("base64")}`,
    };
    await exec(
      "git",
      [
        "--git-dir",
        source,
        "fetch",
        "--depth=1",
        "--no-tags",
        input.repositoryUrl,
        input.sourceSha,
      ],
      {
        env,
        timeout: Math.max(1, input.deadline - Date.now()),
        signal: input.signal,
        maxBuffer: 64_000,
      },
    );
    await exec(
      "git",
      ["--git-dir", source, "update-ref", "refs/heads/review", input.sourceSha],
      { timeout: 5000 },
    );
    await writeFile(
      join(directory, "source.json"),
      JSON.stringify({ sourceSha: input.sourceSha, deadline: input.deadline }),
    );
    const controller = join(directory, "controller.mjs");
    await writeFile(
      controller,
      await readFile(new URL("./sandbox-controller.mjs", import.meta.url)),
    );
    const duration = Math.max(
      1,
      Math.ceil((input.deadline - Date.now()) / 1000),
    );
    const args = [
      "--user",
      "--wait",
      "--pipe",
      "--collect",
      "--quiet",
      `--unit=${unit}`,
      ...properties.flatMap((p) => ["-p", p]),
      "-p",
      `RuntimeMaxSec=${duration}`,
      "bwrap",
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
      runtime,
      "/runtime",
      "--ro-bind",
      source,
      "/input",
      "--ro-bind",
      controller,
      "/controller.mjs",
      "--size",
      "134217728",
      "--tmpfs",
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
      "/runtime/bin/node",
      "/controller.mjs",
    ];
    child = spawn("systemd-run", args, { stdio: ["pipe", "pipe", "pipe"] });
    let buffered = "",
      startupError = "";
    child.stdout?.on("data", (chunk) => {
      buffered += chunk.toString("utf8");
      if (buffered.length > 150_000) {
        void stop();
        return;
      }
      let newline;
      while ((newline = buffered.indexOf("\n")) >= 0) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        try {
          const value = JSON.parse(line);
          const pending = waiting.get(value.id);
          if (
            pending &&
            typeof value.output === "string" &&
            Number.isInteger(value.exitCode)
          ) {
            waiting.delete(value.id);
            pending.resolve({
              ...(value.sourceIntegrity === "changed" ||
              value.sourceIntegrity === "unavailable"
                ? { sourceIntegrity: value.sourceIntegrity }
                : {}),
              command: pending.command,
              status:
                typeof value.unavailableReason === "string"
                  ? "unavailable"
                  : value.exitCode === 0
                    ? "passed"
                    : "failed",
              exitCode: value.exitCode,
              output:
                typeof value.unavailableReason === "string"
                  ? value.unavailableReason + "\n" + value.output
                  : value.output,
              sourceSha: input.sourceSha,
            });
          }
        } catch {}
      }
    });
    child.stderr?.on("data", (chunk) => {
      startupError = (startupError + chunk.toString()).slice(0, 2000);
    });
    child.on("error", (error) => {
      for (const pending of waiting.values()) pending.reject(error);
      waiting.clear();
    });
    child.on("close", () => {
      ended = true;
      for (const pending of waiting.values())
        pending.reject(
          new Error(
            "Isolated execution stopped or exceeded its limits: " +
              startupError,
          ),
        );
      waiting.clear();
    });
    const identity = await run(["git", "rev-parse", "HEAD"], input.signal);
    if (
      identity.status !== "passed" ||
      identity.output.trim() !== input.sourceSha
    )
      throw new Error(
        "Could not materialize the pinned checkout in command isolation",
      );
    return {
      sourceSha: input.sourceSha,
      executionUnit: unit,
      directory,
      run,
      replaceFiles: async (files, signal) => {
        const result = await request({ type: "replace", files }, signal);
        if (result.status !== "passed") throw new Error(result.output);
      },
      verifyFiles: async (files, signal) => {
        let result: ExecutionCheck;
        try {
          result = await request({ type: "verify", files }, signal);
        } catch (error) {
          throw new SourceVerificationError(
            "unavailable",
            error instanceof Error
              ? error.message
              : "Source verification unavailable",
          );
        }
        if (result.status !== "passed")
          throw new SourceVerificationError(
            result.sourceIntegrity ?? "unavailable",
            result.output,
          );
      },
      stop,
    };
  } catch (error) {
    await stop();
    throw new Error(
      "Isolated checkout startup failed. Check repository access and the Linux runner configuration.",
      { cause: error },
    );
  }
}

export async function cleanupExpiredCheckouts() {
  for (const entry of await readdir(tmpdir(), { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("meteroite-review-"))
      continue;
    const directory = join(tmpdir(), entry.name);
    try {
      const source = JSON.parse(
        await readFile(join(directory, "source.json"), "utf8"),
      );
      if (typeof source.deadline === "number" && source.deadline <= Date.now())
        await rm(directory, { recursive: true, force: true });
    } catch {}
  }
}

export async function stopIsolatedExecution(unit: string) {
  if (!/^meteroite-review-[0-9a-f-]{36}\.service$/.test(unit)) return false;
  try {
    await exec("systemctl", ["--user", "stop", unit], { timeout: 4000 });
    return true;
  } catch {
    return false;
  }
}
