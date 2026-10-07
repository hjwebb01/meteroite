/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { DEFAULT_CODING_MODEL_ID } from "./lib/coding_models";
const modules = import.meta.glob("./**/*.ts");
const conclusion = {
  verdict: "incorrect" as const,
  explanation: "The caller rejects null before this branch.",
  evidence: [
    {
      revision: "head" as const,
      commit: "head",
      blobSha: "blob",
      path: "caller.ts",
      line: 1,
      quote: "if (!user) return;",
    },
  ],
  assumptions: ["No checks ran."],
};
async function fixture() {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice" });
  const bob = t.withIdentity({ subject: "bob" });
  const reviewId = await t.run((ctx) =>
    ctx.db.insert("reviews", {
      ownerId: "alice",
      repoOwner: "upstream",
      repoName: "app",
      pullNumber: 7,
      url: "https://github.com/upstream/app/pull/7",
      status: "completed",
      model: DEFAULT_CODING_MODEL_ID,
      instructions: "",
      progress: "Complete",
      updatedAt: 0,
      headSha: "head",
      baseSha: "base",
      sourceOwner: "fork",
      sourceRepo: "app",
      result: {
        summary: "Review",
        outdated: false,
        coverage: {
          changedFiles: 1,
          diffFiles: ["auth.ts"],
          filesRead: [],
          warnings: [],
        },
        findings: [
          {
            id: "finding",
            title: "Null user",
            severity: "high",
            path: "auth.ts",
            line: 1,
            side: "RIGHT",
            explanation: "Could throw",
            suggestion: "Check null",
            evidence: [],
            previousFindingId: null,
          },
        ],
      },
    }),
  );
  const request = {
    reviewId,
    findingId: "finding",
    requestId: "request-123",
    body: "Check the caller.",
  };
  return { t, alice, bob, reviewId, request };
}
test("discussion is private, durable and retains original claim after retraction", async () => {
  const { t, alice, bob, reviewId, request } = await fixture();
  await expect(
    bob.mutation(api.reviewInteractions.discuss, request),
  ).rejects.toThrow("Finding not found");
  const first = await alice.mutation(api.reviewInteractions.discuss, request);
  const attempt = await t.mutation(internal.reviewFindingJobs.claim, {
    workId: first.workId,
    ownerId: "alice",
  });
  expect(attempt).toBe(1);
  await t.mutation(internal.reviewFindingJobs.finish, {
    workId: first.workId,
    attempt: attempt!,
    result: conclusion,
  });
  const saved = await alice.query(api.reviewInteractions.thread, {
    reviewId,
    findingId: "finding",
  });
  expect(saved.messages.map((m) => [m.role, m.body])).toEqual([
    ["user", "Check the caller."],
    ["assistant", "The caller rejects null before this branch."],
  ]);
  expect(saved.messages[1].conclusion?.verdict).toBe("incorrect");
  expect(
    (await alice.query(api.reviews.get, { id: reviewId })).result?.findings[0]
      .explanation,
  ).toBe("Could throw");
  await expect(
    bob.query(api.reviewInteractions.thread, {
      reviewId,
      findingId: "finding",
    }),
  ).rejects.toThrow("Finding not found");
  await expect(
    bob.mutation(api.reviewInteractions.cancel, { workId: first.workId }),
  ).rejects.toThrow("Work not found");
});
test("request identity deduplicates and concurrent conclusion-changing work is rejected", async () => {
  const { t, alice, request } = await fixture();
  const first = await alice.mutation(api.reviewInteractions.discuss, request);
  expect(await alice.mutation(api.reviewInteractions.discuss, request)).toEqual(
    { workId: first.workId, created: false, dispatch: true },
  );
  await expect(
    alice.mutation(api.reviewInteractions.discuss, {
      ...request,
      requestId: "second-request",
    }),
  ).rejects.toThrow("active work");
  await expect(
    alice.mutation(api.reviewInteractions.discuss, {
      ...request,
      body: "Different content",
    }),
  ).rejects.toThrow("identity already used");
  expect(
    await t.mutation(internal.reviewFindingJobs.claim, {
      workId: first.workId,
      ownerId: "bob",
    }),
  ).toBeNull();
  expect(
    await t.mutation(internal.reviewFindingJobs.claim, {
      workId: first.workId,
      ownerId: "alice",
    }),
  ).toBe(1);
  expect(
    await t.mutation(internal.reviewFindingJobs.claim, {
      workId: first.workId,
      ownerId: "alice",
    }),
  ).toBeNull();
});
test("cancel fences late finish and retry produces exactly one response", async () => {
  const { t, alice, reviewId, request } = await fixture();
  const first = await alice.mutation(api.reviewInteractions.discuss, request);
  const attempt = await t.mutation(internal.reviewFindingJobs.claim, {
    workId: first.workId,
    ownerId: "alice",
  });
  await alice.mutation(api.reviewInteractions.cancel, { workId: first.workId });
  expect(
    await t.mutation(internal.reviewFindingJobs.finish, {
      workId: first.workId,
      attempt: attempt!,
      result: conclusion,
    }),
  ).toBe(false);
  const next = await alice.mutation(api.reviewInteractions.discuss, {
    ...request,
    requestId: "retry-request",
  });
  const nextAttempt = await t.mutation(internal.reviewFindingJobs.claim, {
    workId: next.workId,
    ownerId: "alice",
  });
  expect(
    await t.mutation(internal.reviewFindingJobs.finish, {
      workId: next.workId,
      attempt: nextAttempt!,
      result: conclusion,
    }),
  ).toBe(true);
  expect(
    await t.mutation(internal.reviewFindingJobs.finish, {
      workId: next.workId,
      attempt: nextAttempt!,
      result: conclusion,
    }),
  ).toBe(false);
  const thread = await alice.query(api.reviewInteractions.thread, {
    reviewId,
    findingId: "finding",
  });
  expect(
    thread.messages.filter((m) => m.role === "assistant").map((m) => m.body),
  ).toEqual(["The caller rejects null before this branch."]);
  expect(thread.work.map((w) => w.status)).toEqual(["completed", "cancelled"]);
});
test("investigation has immutable limits, capped spending, owner fencing and deadline expiry", async () => {
  const { t, alice, reviewId, request } = await fixture();
  const input = {
    ownerId: "alice",
    reviewId,
    findingId: "finding",
    requestId: request.requestId,
    model: DEFAULT_CODING_MODEL_ID,
    maxDurationMs: 30_000,
    maxCostMicros: 100_000,
    price: {
      inputMicrosPerToken: 1,
      outputMicrosPerToken: 1,
      quotedAt: Date.now(),
    },
  };
  const started = await t.mutation(
    internal.reviewFindingJobs.investigate,
    input,
  );
  expect(
    await t.mutation(internal.reviewFindingJobs.investigate, input),
  ).toEqual({ workId: started.workId, dispatch: true });
  await expect(
    t.mutation(internal.reviewFindingJobs.investigate, {
      ...input,
      maxCostMicros: 200_000,
    }),
  ).rejects.toThrow("identity already used");
  await expect(
    t.mutation(internal.reviewFindingJobs.investigate, {
      ...input,
      requestId: "other-request",
      ownerId: "bob",
    }),
  ).rejects.toThrow("Finding not found");
  const attempt = await t.mutation(internal.reviewFindingJobs.claim, {
    workId: started.workId,
    ownerId: "alice",
  });
  await t.mutation(internal.reviewFindingJobs.reserve, {
    workId: started.workId,
    attempt: attempt!,
    amount: 80_000,
  });
  await expect(
    t.mutation(internal.reviewFindingJobs.reserve, {
      workId: started.workId,
      attempt: attempt!,
      amount: 30_000,
    }),
  ).rejects.toThrow("cost cap reached");
  expect(
    (
      await alice.query(api.reviewInteractions.thread, {
        reviewId,
        findingId: "finding",
      })
    ).work[0].reservedCostMicros,
  ).toBe(80_000);
  await t.run((ctx) =>
    ctx.db.patch("reviewFindingWork", started.workId, {
      deadline: Date.now() - 1,
      updatedAt: Date.now() - 120_000,
    }),
  );
  await t.mutation(internal.reviewFindingJobs.expire, {});
  const work = (
    await alice.query(api.reviewInteractions.thread, {
      reviewId,
      findingId: "finding",
    })
  ).work[0];
  expect(work.status).toBe("failed");
  expect(work.stopReason).toBe("time-limit");
  expect(
    await t.mutation(internal.reviewFindingJobs.finish, {
      workId: started.workId,
      attempt: attempt!,
      result: conclusion,
    }),
  ).toBe(false);
});
test("retried work waits a full queue window before expiring, regardless of when it was created", async () => {
  const { t, alice, request } = await fixture();
  const { workId } = await alice.mutation(
    api.reviewInteractions.discuss,
    request,
  );
  await alice.mutation(api.reviewInteractions.cancel, { workId });
  await t.run((ctx) =>
    ctx.db.patch("reviewFindingWork", workId, {
      createdAt: Date.now() - 60 * 60_000,
    }),
  );
  await alice.mutation(api.reviewInteractions.retry, { workId });
  await t.run((ctx) =>
    ctx.db.patch("reviewFindingWork", workId, {
      updatedAt: Date.now() - 5 * 60_000,
    }),
  );
  await t.mutation(internal.reviewFindingJobs.expire, {});
  const status = async () =>
    (await t.run((ctx) => ctx.db.get("reviewFindingWork", workId)))!.status;
  expect(await status()).toBe("queued");
  await t.run((ctx) =>
    ctx.db.patch("reviewFindingWork", workId, {
      updatedAt: Date.now() - 11 * 60_000,
    }),
  );
  await t.mutation(internal.reviewFindingJobs.expire, {});
  expect(await status()).toBe("failed");
});
test("retry archives previous attempt evidence and resets current checks and proposal errors without widening the cap", async () => {
  const { t, alice, bob, reviewId, request } = await fixture();
  const { workId } = await alice.mutation(
    api.reviewInteractions.discuss,
    request,
  );
  const first = await t.mutation(internal.reviewFindingJobs.claim, {
    workId,
    ownerId: "alice",
  });
  for (let i = 0; i < 8; i++)
    await t.mutation(internal.reviewFindingJobs.saveCheck, {
      workId,
      attempt: first!,
      check: {
        command: ["node", "--test"],
        status: "failed",
        exitCode: 1,
        output: `prior check ${i}`,
        sourceSha: "head",
      },
    });
  await t.mutation(internal.reviewFindingJobs.recordPremise, {
    workId,
    attempt: first!,
    result: conclusion,
    proposalError: "Earlier proposal unavailable",
  });
  await alice.mutation(api.reviewInteractions.cancel, { workId });
  await alice.mutation(api.reviewInteractions.retry, { workId });
  const queued = await alice.query(api.reviewInteractions.thread, {
    reviewId,
    findingId: "finding",
  });
  expect(queued.work[0].checks).toEqual([]);
  expect(queued.work[0].proposalError).toBeUndefined();
  expect(queued.work[0].result).toBeUndefined();
  expect(queued.attempts).toHaveLength(1);
  expect(queued.attempts[0]).toMatchObject({
    attempt: first,
    status: "cancelled",
    result: conclusion,
    proposalError: "Earlier proposal unavailable",
    stopReason: "cancelled",
  });
  expect(queued.attempts[0].checks).toHaveLength(8);
  const next = await t.mutation(internal.reviewFindingJobs.claim, {
    workId,
    ownerId: "alice",
    generation: 1,
  });
  expect(
    await t.mutation(internal.reviewFindingJobs.saveCheck, {
      workId,
      attempt: next!,
      check: {
        command: ["node", "--test"],
        status: "passed",
        exitCode: 0,
        output: "new result",
        sourceSha: "head",
      },
    }),
  ).toBe(true);
  expect(
    (
      await alice.query(api.reviewInteractions.thread, {
        reviewId,
        findingId: "finding",
      })
    ).work[0].checks,
  ).toHaveLength(1);
  await expect(
    bob.query(api.reviewInteractions.thread, {
      reviewId,
      findingId: "finding",
    }),
  ).rejects.toThrow("Finding not found");
});
test("expired attempt cannot reserve spending, append check results, or attach a sandbox", async () => {
  const { t, alice, request } = await fixture();
  const { workId } = await alice.mutation(
    api.reviewInteractions.discuss,
    request,
  );
  const attempt = await t.mutation(internal.reviewFindingJobs.claim, {
    workId,
    ownerId: "alice",
  });
  await t.run((ctx) =>
    ctx.db.patch("reviewFindingWork", workId, { deadline: Date.now() - 1 }),
  );
  await expect(
    t.mutation(internal.reviewFindingJobs.reserve, {
      workId,
      attempt: attempt!,
      amount: 1,
    }),
  ).rejects.toMatchObject({ data: { reason: "time-limit" } });
  expect(
    await t.mutation(internal.reviewFindingJobs.saveCheck, {
      workId,
      attempt: attempt!,
      check: {
        command: ["node"],
        status: "passed",
        output: "late",
        sourceSha: "head",
      },
    }),
  ).toBe(false);
  expect(
    await t.mutation(internal.reviewFindingJobs.attachExecution, {
      workId,
      attempt: attempt!,
      unit: "meteroite-review-00000000-0000-0000-0000-000000000000.service",
    }),
  ).toBe(false);
});
test("latest reconsidered verdict per finding is visible only to the owner", async () => {
  const { t, alice, bob, reviewId, request } = await fixture();
  expect(
    await alice.query(api.reviewInteractions.verdicts, { reviewId }),
  ).toEqual({});
  for (const [requestId, verdict] of [
    ["request-first", "supported"],
    ["request-second", "incorrect"],
  ] as const) {
    const { workId } = await alice.mutation(api.reviewInteractions.discuss, {
      ...request,
      requestId,
    });
    const attempt = await t.mutation(internal.reviewFindingJobs.claim, {
      workId,
      ownerId: "alice",
    });
    await t.mutation(internal.reviewFindingJobs.finish, {
      workId,
      attempt: attempt!,
      result: { ...conclusion, verdict },
    });
  }
  await alice.mutation(api.reviewInteractions.discuss, {
    ...request,
    requestId: "request-pending",
  });
  expect(
    await alice.query(api.reviewInteractions.verdicts, { reviewId }),
  ).toEqual({ finding: "incorrect" });
  await expect(
    bob.query(api.reviewInteractions.verdicts, { reviewId }),
  ).rejects.toThrow("Review not found");
});
