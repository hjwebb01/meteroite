// @vitest-environment node
import { expect, test, vi } from "vitest";
import {
  createCheckExecution,
  SourceVerificationError,
  ProposalRejectedError,
  type ExecutionCheck,
  type ProposalFiles,
} from "./check-execution";
import { FindingStopped } from "./finding-stop";

const signal = new AbortController().signal;
const heartbeat = async () => {};

function fixture({
  status = "passed",
  verificationError,
}: {
  status?: ExecutionCheck["status"];
  verificationError?: Error;
} = {}) {
  let source = "pinned";
  const adapter = {
    sourceSha: "head",
    async run(command: string[]): Promise<ExecutionCheck> {
      if (command[0] === "mutate") source = "changed";
      return { command, status, output: "command output", sourceSha: "head" };
    },
    async replaceFiles(files: ProposalFiles) {
      source = files[0]?.replacement ?? "pinned";
    },
    async verifyFiles(files: ProposalFiles) {
      if (verificationError) throw verificationError;
      const expected = files[0]?.replacement ?? "pinned";
      if (source !== expected)
        throw new SourceVerificationError("changed", "Source text changed");
    },
  };
  return { execution: createCheckExecution(adapter), adapter };
}

test.each(["passed", "failed", "unavailable"] as const)(
  "preserves a %s command outcome when pinned source is unchanged",
  async (status) => {
    const { execution } = fixture({ status });
    await expect(
      execution.runCheck(["test"], signal, heartbeat),
    ).resolves.toEqual({
      command: ["test"],
      status,
      output: "command output",
      sourceSha: "head",
    });
  },
);

test("a successful command that changes pinned source cannot validate it", async () => {
  const { execution } = fixture();
  const result = await execution.runCheck(["mutate"], signal, heartbeat);
  expect(result.status).toBe("unavailable");
  expect(result.output).toContain("This command changed pinned source");
  expect(result.output).toContain("command output");
});

test("comparison failure is distinct from source mutation", async () => {
  const { execution } = fixture({
    verificationError: new SourceVerificationError(
      "unavailable",
      "Runner ended",
    ),
  });
  const result = await execution.runCheck(["test"], signal, heartbeat);
  expect(result.status).toBe("unavailable");
  expect(result.output).toContain("Source comparison was unavailable");
  expect(result.output).not.toContain("This command changed");
});

test("Proposal Checks validate materialized source and retain command order", async () => {
  const { execution } = fixture();
  const results = await execution.validateProposal(
    [{ path: "source.ts", replacement: "proposed" }],
    [["test"], ["mutate"], ["later"]],
    signal,
    heartbeat,
  );
  expect(results.map((result) => result.command)).toEqual([
    ["test"],
    ["mutate"],
    ["later"],
  ]);
  expect(results.map((result) => result.status)).toEqual([
    "passed",
    "unavailable",
    "unavailable",
  ]);
  expect(results[1].output).toContain("cannot validate the saved manifest");
});

test("an empty Proposal command list still materializes source and returns no Checks", async () => {
  const { execution, adapter } = fixture();
  const replace = vi.spyOn(adapter, "replaceFiles");
  const files = [{ path: "source.ts", replacement: "proposed" }];
  await expect(
    execution.validateProposal(files, [], signal, heartbeat),
  ).resolves.toEqual([]);
  expect(replace).toHaveBeenCalledWith(files, signal);
});

test("an ended Lease during comparison is not converted to an unavailable Check", async () => {
  const { execution } = fixture({
    verificationError: new Error("Runner ended"),
  });
  const stopped = new FindingStopped("cancelled", "Lease cancelled");
  await expect(
    execution.runCheck(["test"], signal, async () => {
      throw stopped;
    }),
  ).rejects.toBe(stopped);
});

test("Proposal cancellation prevents further commands", async () => {
  const { execution, adapter } = fixture();
  const run = vi.spyOn(adapter, "run");
  const stopped = new FindingStopped("time-limit", "Lease expired");
  await expect(
    execution.validateProposal(
      [{ path: "source.ts", replacement: "proposed" }],
      [["first"], ["second"]],
      signal,
      async (progress) => {
        if (progress?.includes("second")) throw stopped;
      },
    ),
  ).rejects.toBe(stopped);
  expect(run.mock.calls.map(([command]) => command)).toEqual([["first"]]);
});

test("execution errors propagate without becoming source-comparison failures", async () => {
  const { execution, adapter } = fixture();
  const stopped = new FindingStopped("cancelled", "Execution cancelled");
  vi.spyOn(adapter, "run").mockRejectedValueOnce(stopped);
  await expect(execution.runCheck(["test"], signal, heartbeat)).rejects.toBe(
    stopped,
  );
});

test("runner failure retains completed proposal checks and marks later checks unavailable", async () => {
  const { execution, adapter } = fixture();
  vi.spyOn(adapter, "run")
    .mockResolvedValueOnce({
      command: ["first"],
      status: "passed",
      output: "ok",
      sourceSha: "head",
    })
    .mockRejectedValue(new Error("Runner disconnected"));
  const checks = await execution.validateProposal(
    [{ path: "source.ts", replacement: "proposed" }],
    [["first"], ["second"], ["third"]],
    signal,
    heartbeat,
  );
  expect(checks.map((check) => check.status)).toEqual([
    "passed",
    "unavailable",
    "unavailable",
  ]);
  expect(checks[1]).toMatchObject({
    command: ["second"],
    sourceSha: "head",
    output: expect.stringContaining("Runner disconnected"),
  });
});

test("failed materialization is unavailable validation and runs no commands", async () => {
  const { execution, adapter } = fixture();
  vi.spyOn(adapter, "replaceFiles").mockRejectedValue(
    new Error("Runner disconnected"),
  );
  const run = vi.spyOn(adapter, "run");
  const checks = await execution.validateProposal(
    [{ path: "source.ts", replacement: "proposed" }],
    [["test"]],
    signal,
    heartbeat,
  );
  expect(checks).toEqual([
    expect.objectContaining({ status: "unavailable", command: [] }),
  ]);
  expect(run).not.toHaveBeenCalled();
});

test("lease cancellation during runner failure prevents an unavailable result", async () => {
  const { execution, adapter } = fixture();
  vi.spyOn(adapter, "run").mockRejectedValue(new Error("Runner disconnected"));
  const stopped = new FindingStopped("cancelled", "Lease cancelled");
  await expect(
    execution.runCheck(["test"], signal, async () => {
      throw stopped;
    }),
  ).rejects.toBe(stopped);
});

test("unsafe proposal rejection is not a runner outage", async () => {
  const { execution, adapter } = fixture();
  const rejected = new ProposalRejectedError("Unsupported proposal file");
  vi.spyOn(adapter, "replaceFiles").mockRejectedValue(rejected);
  await expect(
    execution.validateProposal(
      [{ path: "../unsafe", replacement: "proposed" }],
      [["test"]],
      signal,
      heartbeat,
    ),
  ).rejects.toBe(rejected);
});
