// @vitest-environment node
import { ConvexError } from "convex/values";
import { expect, test, vi } from "vitest";
import {
  runFindingAttempt,
  type AttemptAdapters,
  type AttemptInput,
  type ModelAdapter,
} from "./finding-attempt";
import { conclusionSchema } from "./finding-evidence";
import { findingStopReason } from "./finding-stop";
import type { FindingLease } from "./finding-lease";

const verdict = {
  verdict: "supported" as const,
  explanation: "Caller does not guard null.",
  evidence: [],
  assumptions: [],
};
const change = {
  rationale: "Guard null",
  files: [],
  checks: [["node", "--test"]],
};

function input(
  kind: "discussion" | "investigation",
  deadline = Date.now() + 60_000,
) {
  return {
    ownerId: "alice",
    work: {
      kind,
      deadline,
      headSha: "head",
      baseSha: "base",
      findingId: "finding",
      sourceOwner: "fork",
      sourceRepo: "app",
    },
    review: { _id: "review" },
    finding: { id: "finding" },
    messages: [],
  } as unknown as AttemptInput;
}

function harness(
  overrides: {
    explore?: ModelAdapter["explore"];
    head?: Partial<{ sha: string; owner: string; repo: string }>;
    runtime?: boolean;
    cost?: unknown;
    heartbeat?: () => Promise<void>;
  } = {},
) {
  const runtime = {
    executionUnit: "unit",
    runCheck: vi.fn(async (command: string[]) => ({
      command,
      status: "failed" as const,
      output: "fixture failure",
      sourceSha: "head",
    })),
    validateProposal: vi.fn(async () => [
      {
        command: ["node", "--test"],
        status: "passed" as const,
        output: "",
        sourceSha: "head",
      },
    ]),
    stop: vi.fn(async () => {}),
  };
  const lease = {
    heartbeat: vi.fn(overrides.heartbeat ?? (async () => {})),
    attachExecution: vi.fn(async () => {}),
    reserve: vi.fn(async () => {
      if (overrides.cost) throw overrides.cost;
    }),
    saveCheck: vi.fn(async () => {}),
    recordPremise: vi.fn(async () => {}),
    saveProposal: vi.fn(async () => {}),
    finish: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
  };
  const validate = vi.fn((draft: typeof verdict) => draft);
  const adapters = {
    model: {
      explore:
        overrides.explore ??
        (async ({ beforeCall }) => {
          await beforeCall([]);
          return [];
        }),
      produce: async ({ schema, beforeCall }) => {
        await beforeCall([]);
        return (schema as unknown) === conclusionSchema ? verdict : change;
      },
    } as ModelAdapter,
    lease: lease as unknown as FindingLease,
    source: async () => ({
      reader: {
        listFiles: async () => [],
        readFile: async () => ({}),
        validate,
      },
      currentHead: async () => ({
        sha: "head",
        owner: "fork",
        repo: "app",
        branch: "feature",
        ...overrides.head,
      }),
      canonicalize: async () => ({ files: [] }),
    }),
    execution: {
      open: async () =>
        overrides.runtime === false
          ? { limitation: "Runner unavailable" }
          : { runtime: runtime as never },
    },
    price: async () => ({
      inputMicrosPerToken: 1,
      outputMicrosPerToken: 1,
      quotedAt: Date.now(),
    }),
    ranChecks: async () => true,
  } as unknown as AttemptAdapters;
  return { adapters, lease, runtime, validate };
}

test("finishes the lease and stops the checkout after a supported investigation", async () => {
  const { adapters, lease, runtime } = harness();
  await runFindingAttempt(input("investigation"), adapters);
  expect(lease.saveProposal).toHaveBeenCalledTimes(1);
  expect(lease.finish).toHaveBeenCalledWith(verdict);
  expect(lease.fail).not.toHaveBeenCalled();
  expect(runtime.stop).toHaveBeenCalled();
});

test("a discussion opens no checkout and proposes nothing", async () => {
  const { adapters, lease } = harness();
  await runFindingAttempt(input("discussion"), adapters);
  expect(lease.attachExecution).not.toHaveBeenCalled();
  expect(lease.saveProposal).not.toHaveBeenCalled();
  expect(lease.finish).toHaveBeenCalledWith(verdict);
});

test("runCheck is offered only with a checkout and its result is saved to the lease", async () => {
  const { adapters, lease, runtime } = harness({
    explore: async ({ tools }) => {
      await (tools.runCheck.execute as (i: unknown) => Promise<unknown>)({
        command: ["node", "--test"],
      });
      return [];
    },
  });
  await runFindingAttempt(input("investigation"), adapters);
  expect(runtime.runCheck).toHaveBeenCalled();
  expect(lease.saveCheck).toHaveBeenCalledWith(
    expect.objectContaining({ status: "failed" }),
  );

  const offered = vi.fn(async ({ tools }) => {
    expect(Object.keys(tools)).toEqual(["listFiles", "readFile"]);
    return [];
  });
  const withoutRunner = harness({ runtime: false, explore: offered });
  await runFindingAttempt(input("investigation"), withoutRunner.adapters);
  expect(offered).toHaveBeenCalled();
  expect(withoutRunner.lease.saveCheck).toHaveBeenCalledWith(
    expect.objectContaining({
      status: "unavailable",
      output: "Runner unavailable",
    }),
  );
  const [proposal] = withoutRunner.lease.saveProposal.mock
    .calls[0] as unknown as [{ checks: Array<{ status: string }> }];
  expect(proposal.checks.every((c) => c.status === "unavailable")).toBe(true);
});

test("a source that moved on drops the proposal but keeps the verdict", async () => {
  const { adapters, lease } = harness({ head: { sha: "newer" } });
  await runFindingAttempt(input("investigation"), adapters);
  expect(lease.saveProposal).not.toHaveBeenCalled();
  expect(lease.recordPremise).toHaveBeenLastCalledWith(
    verdict,
    "PR source changed. Start a new investigation.",
  );
  expect(lease.finish).toHaveBeenCalledWith(verdict);
});

test("a cost-limit stop ends the attempt as cost-limit and rethrows", async () => {
  const cost = new ConvexError({ reason: "cost-limit", message: "cost cap" });
  const { adapters, lease, runtime } = harness({ cost });
  await expect(
    runFindingAttempt(input("investigation"), adapters),
  ).rejects.toBe(cost);
  const [error, signal] = lease.fail.mock.calls[0] as unknown as [
    unknown,
    AbortSignal,
  ];
  expect(findingStopReason(error, signal)).toBe("cost-limit");
  expect(lease.finish).not.toHaveBeenCalled();
  expect(lease.saveProposal).not.toHaveBeenCalled();
  expect(runtime.stop).toHaveBeenCalled();
});

test("passing the deadline ends the attempt as time-limit", async () => {
  const { adapters, lease, runtime } = harness({
    explore: ({ signal }) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason)),
      ),
  });
  await expect(
    runFindingAttempt(input("investigation", Date.now() + 20), adapters),
  ).rejects.toThrow();
  const [error, signal] = lease.fail.mock.calls[0] as unknown as [
    unknown,
    AbortSignal,
  ];
  expect(findingStopReason(error, signal)).toBe("time-limit");
  expect(runtime.stop).toHaveBeenCalled();
});

test("a cancelled lease seen by the poll aborts the in-flight model call", async () => {
  vi.useFakeTimers();
  try {
    const cancelled = new ConvexError({
      reason: "cancelled",
      message: "Finding work cancelled",
    });
    let beats = 0;
    const { adapters, lease } = harness({
      heartbeat: async () => {
        if (++beats > 3) throw cancelled;
      },
      explore: ({ signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason)),
        ),
    });
    const run = runFindingAttempt(input("investigation"), adapters);
    const settled = expect(run).rejects.toThrow("Finding work cancelled");
    await vi.advanceTimersByTimeAsync(2000);
    await settled;
    const [error, signal] = lease.fail.mock.calls[0] as unknown as [
      unknown,
      AbortSignal,
    ];
    expect(findingStopReason(error, signal)).toBe("cancelled");
  } finally {
    vi.useRealTimers();
  }
});

test("an infrastructure failure fails the lease once and is not swallowed", async () => {
  const { adapters, lease } = harness({
    explore: async () => {
      throw new Error("Model unavailable");
    },
  });
  await expect(
    runFindingAttempt(input("investigation"), adapters),
  ).rejects.toThrow("Model unavailable");
  expect(lease.fail).toHaveBeenCalledTimes(1);
  expect(lease.finish).not.toHaveBeenCalled();
});
