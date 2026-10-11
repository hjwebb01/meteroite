import { findingStopReason } from "./finding-stop";

export class SourceVerificationError extends Error {
  constructor(
    readonly kind: "changed" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "SourceVerificationError";
  }
}

export class ProposalRejectedError extends Error {}

export type ExecutionCheck = {
  command: string[];
  status: "passed" | "failed" | "unavailable";
  exitCode?: number;
  output: string;
  sourceSha: string;
  sourceIntegrity?: "changed" | "unavailable";
};

export type ProposalFiles = Array<{
  path: string;
  replacement: string | null;
}>;
type Heartbeat = (progress?: string) => Promise<void>;

// Internal seam: the isolated runtime and controlled tests supply these operations.
type ExecutionAdapter = {
  sourceSha: string;
  run(command: string[], signal: AbortSignal): Promise<ExecutionCheck>;
  replaceFiles(files: ProposalFiles, signal: AbortSignal): Promise<void>;
  verifyFiles(files: ProposalFiles, signal: AbortSignal): Promise<void>;
};

/** Command outcomes only validate source that still matches the pinned snapshot or Proposal. */
export function createCheckExecution(adapter: ExecutionAdapter) {
  async function unavailable(
    error: unknown,
    command: string[],
    signal: AbortSignal,
    heartbeat: Heartbeat,
  ): Promise<ExecutionCheck> {
    if (error instanceof ProposalRejectedError) throw error;
    if (findingStopReason(error, signal) !== "infrastructure") throw error;
    // A runner failure must not hide cancellation or expiry of this Attempt.
    await heartbeat();
    return {
      command,
      status: "unavailable",
      output: `Validation could not complete: ${error instanceof Error ? error.message : "isolated runner unavailable"}`,
      sourceSha: adapter.sourceSha,
    };
  }

  async function runVerifiedCheck(
    command: string[],
    files: ProposalFiles,
    signal: AbortSignal,
    heartbeat: Heartbeat,
  ) {
    let check: ExecutionCheck;
    try {
      check = await adapter.run(command, signal);
    } catch (error) {
      return unavailable(error, command, signal, heartbeat);
    }
    try {
      await adapter.verifyFiles(files, signal);
    } catch (error) {
      // An ended Lease must stop the work, rather than become an unavailable Check.
      if (findingStopReason(error, signal) !== "infrastructure") throw error;
      await heartbeat();
      const [source, target] = files.length
        ? ["pinned/proposed source", "the saved manifest"]
        : ["pinned source", "the pinned snapshot"];
      check.status = "unavailable";
      check.output =
        (error instanceof SourceVerificationError && error.kind === "changed"
          ? `This command changed ${source}; its result cannot validate ${target}. `
          : `Source comparison was unavailable; this result cannot validate ${target}. `) +
        (error instanceof Error ? error.message : "") +
        "\n" +
        check.output;
    }
    return check;
  }

  return {
    runCheck: (command: string[], signal: AbortSignal, heartbeat: Heartbeat) =>
      runVerifiedCheck(command, [], signal, heartbeat),
    async validateProposal(
      files: ProposalFiles,
      commands: string[][],
      signal: AbortSignal,
      heartbeat: Heartbeat,
    ) {
      await heartbeat("Applying the proposal in the isolated checkout");
      try {
        await adapter.replaceFiles(files, signal);
      } catch (error) {
        const checks = [];
        for (const command of commands.length ? commands : [[]])
          checks.push(await unavailable(error, command, signal, heartbeat));
        return checks;
      }
      const checks = [];
      for (const command of commands) {
        await heartbeat(`Validating proposal: ${command.join(" ")}`);
        checks.push(await runVerifiedCheck(command, files, signal, heartbeat));
      }
      return checks;
    },
  };
}

export type CheckExecution = ReturnType<typeof createCheckExecution>;
