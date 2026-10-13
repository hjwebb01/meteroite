/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { DEFAULT_CODING_MODEL_ID } from "./lib/coding_models";

const modules = import.meta.glob("./**/*.ts");
async function fixture() {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice" });
  const bob = t.withIdentity({ subject: "bob" });
  const id = await t.run((ctx) =>
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
        summary: "Private review",
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
  const snapshot = await alice.query(api.reviews.publication, { id });
  return { t, alice, bob, id, snapshot };
}

test("publication snapshots and reservations check ownership and changed content", async () => {
  const { t, bob, id, snapshot } = await fixture();
  await expect(bob.query(api.reviews.publication, { id })).rejects.toThrow(
    "Review not found",
  );
  await expect(
    t.mutation(internal.reviewPublications.claim, {
      id,
      ownerId: "bob",
      attemptId: "attempt",
      source: snapshot.source,
    }),
  ).rejects.toThrow("Review not found");
  expect(
    await t.mutation(internal.reviewPublications.claim, {
      id,
      ownerId: "alice",
      attemptId: "attempt",
      source: snapshot.source + "changed",
    }),
  ).toEqual({ state: "changed" });
});

test("concurrent publication attempts have one authorization owner", async () => {
  const { t, id, snapshot } = await fixture();
  const claims = await Promise.all(
    ["one", "two"].map((attemptId) =>
      t.mutation(internal.reviewPublications.claim, {
        id,
        ownerId: "alice",
        attemptId,
        source: snapshot.source,
      }),
    ),
  );
  expect(claims.map((claim) => claim.state).sort()).toEqual([
    "busy",
    "claimed",
  ]);
  const winning = claims[0].state === "claimed" ? "one" : "two";
  expect(
    await t.mutation(internal.reviewPublications.authorizeWrite, {
      id,
      ownerId: "alice",
      attemptId: winning === "one" ? "two" : "one",
    }),
  ).toBe(false);
  expect(
    await t.mutation(internal.reviewPublications.authorizeWrite, {
      id,
      ownerId: "alice",
      attemptId: winning,
    }),
  ).toBe(true);
});

test("a real investigation conclusion arriving after reservation invalidates sending", async () => {
  const { t, alice, id, snapshot } = await fixture();
  expect(
    await t.mutation(internal.reviewPublications.claim, {
      id,
      ownerId: "alice",
      attemptId: "attempt",
      source: snapshot.source,
    }),
  ).toEqual({ state: "claimed" });
  const work = await alice.mutation(api.reviewInteractions.discuss, {
    reviewId: id,
    findingId: "finding",
    requestId: "reconsider",
    body: "Check the caller.",
  });
  const attempt = await t.mutation(internal.reviewFindingJobs.claim, {
    workId: work.workId,
    ownerId: "alice",
  });
  await t.mutation(internal.reviewFindingJobs.finish, {
    workId: work.workId,
    attempt: attempt!,
    result: {
      verdict: "incorrect",
      explanation: "The caller checks null.",
      evidence: [],
      assumptions: ["Static inspection only"],
    },
  });
  const latest = await alice.query(api.reviews.publication, { id });
  expect(latest.excludedFindingIds).toEqual(["finding"]);
  expect(latest.source).not.toBe(snapshot.source);
  expect(
    await t.mutation(internal.reviewPublications.authorizeWrite, {
      id,
      ownerId: "alice",
      attemptId: "attempt",
    }),
  ).toBe(false);
});

test("abandoned prewrite reservations can expire but started/uncertain writes cannot be duplicated", async () => {
  const { t, alice, id, snapshot } = await fixture();
  await t.run((ctx) =>
    ctx.db.patch("reviews", id, {
      githubPublication: {
        attemptId: "old",
        source: snapshot.source,
        state: "publishing",
        startedAt: Date.now() - 60_001,
      },
    }),
  );
  expect(
    await t.mutation(internal.reviewPublications.claim, {
      id,
      ownerId: "alice",
      attemptId: "new",
      source: snapshot.source,
    }),
  ).toEqual({ state: "claimed" });
  expect(
    await t.mutation(internal.reviewPublications.authorizeWrite, {
      id,
      ownerId: "alice",
      attemptId: "old",
    }),
  ).toBe(false);
  expect(
    await t.mutation(internal.reviewPublications.authorizeWrite, {
      id,
      ownerId: "alice",
      attemptId: "new",
    }),
  ).toBe(true);
  await t.mutation(internal.reviewPublications.fail, {
    id,
    ownerId: "alice",
    attemptId: "new",
    uncertain: true,
  });
  expect(
    await t.mutation(internal.reviewPublications.claim, {
      id,
      ownerId: "alice",
      attemptId: "duplicate",
      source: snapshot.source,
    }),
  ).toEqual({ state: "busy" });
  const githubReview = {
    id: 9,
    url: "https://github.com/upstream/app/pull/7#pullrequestreview-9",
    headSha: "head",
    postedAt: 1,
  };
  await t.mutation(internal.reviewPublications.recover, {
    id,
    ownerId: "alice",
    githubReview,
  });
  expect((await alice.query(api.reviews.get, { id })).githubReview).toEqual(
    githubReview,
  );
  expect(
    (await alice.query(api.reviews.get, { id })).githubPublication,
  ).toBeUndefined();
});

test("publication recovery validates owner, remote review identity, target URL and saved commit", async () => {
  const { t, alice, id } = await fixture();
  const posted = {
    id: 9,
    url: "https://github.com/upstream/app/pull/7#pullrequestreview-9",
    headSha: "head",
    postedAt: 1,
  };
  await expect(
    t.mutation(internal.reviewPublications.recover, {
      id,
      ownerId: "bob",
      githubReview: posted,
    }),
  ).rejects.toThrow("Review not found");
  for (const invalid of [
    { ...posted, id: 0 },
    {
      ...posted,
      url: "https://example.com/upstream/app/pull/7#pullrequestreview-9",
    },
    {
      ...posted,
      url: "https://github.com/upstream/app/pull/8#pullrequestreview-9",
    },
    { ...posted, headSha: "different" },
  ]) {
    await expect(
      t.mutation(internal.reviewPublications.recover, {
        id,
        ownerId: "alice",
        githubReview: invalid,
      }),
    ).rejects.toThrow(/match/);
  }
  await t.mutation(internal.reviewPublications.recover, {
    id,
    ownerId: "alice",
    githubReview: posted,
  });
  await expect(
    t.mutation(internal.reviewPublications.recover, {
      id,
      ownerId: "alice",
      githubReview: {
        ...posted,
        id: 10,
        url: "https://github.com/upstream/app/pull/7#pullrequestreview-10",
      },
    }),
  ).rejects.toThrow("different GitHub review");
  expect((await alice.query(api.reviews.get, { id })).githubReview).toEqual(
    posted,
  );
});

test("only an old matching attempt can be reset, and a fresh content confirmation is required", async () => {
  const { t, alice, id, snapshot } = await fixture();
  const args = { id, ownerId: "alice", attemptId: "abandoned" };
  await t.run((ctx) =>
    ctx.db.patch("reviews", id, {
      githubPublication: {
        attemptId: args.attemptId,
        source: snapshot.source,
        state: "publishing",
        startedAt: Date.now(),
        remoteStartedAt: Date.now(),
      },
    }),
  );
  expect(await t.mutation(internal.reviewPublications.reset, args)).toBe(false);
  await expect(
    t.mutation(internal.reviewPublications.reset, { ...args, ownerId: "bob" }),
  ).rejects.toThrow("Review not found");
  await t.run(async (ctx) => {
    const review = await ctx.db.get("reviews", id);
    await ctx.db.patch("reviews", id, {
      githubPublication: {
        ...review!.githubPublication!,
        remoteStartedAt: Date.now() - 15 * 60_000 - 1,
      },
    });
  });
  expect(
    await t.mutation(internal.reviewPublications.reset, {
      ...args,
      attemptId: "other",
    }),
  ).toBe(false);
  expect(await t.mutation(internal.reviewPublications.reset, args)).toBe(true);
  expect(
    (await alice.query(api.reviews.get, { id })).githubPublication,
  ).toBeUndefined();
  expect(
    await t.mutation(internal.reviewPublications.authorizeWrite, args),
  ).toBe(false);
  const fresh = await alice.query(api.reviews.publication, { id });
  expect(fresh.source).not.toBe(snapshot.source);
  expect(
    await t.mutation(internal.reviewPublications.claim, {
      ...args,
      attemptId: "retry",
      source: snapshot.source,
    }),
  ).toEqual({ state: "changed" });
  expect(
    await t.mutation(internal.reviewPublications.claim, {
      ...args,
      attemptId: "retry",
      source: fresh.source,
    }),
  ).toEqual({ state: "claimed" });
});
