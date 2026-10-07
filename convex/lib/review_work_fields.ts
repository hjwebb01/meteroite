import { v } from "convex/values";

export const workStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
);
export const workEvidence = v.object({
  revision: v.union(v.literal("head"), v.literal("diffLeft")),
  commit: v.string(),
  blobSha: v.string(),
  path: v.string(),
  line: v.number(),
  quote: v.string(),
});
export const workConclusion = v.object({
  verdict: v.union(
    v.literal("supported"),
    v.literal("incorrect"),
    v.literal("could-not-reproduce"),
    v.literal("inconclusive"),
  ),
  explanation: v.string(),
  evidence: v.array(workEvidence),
  assumptions: v.array(v.string()),
});
export const workCheck = v.object({
  command: v.array(v.string()),
  status: v.union(
    v.literal("passed"),
    v.literal("failed"),
    v.literal("unavailable"),
  ),
  exitCode: v.optional(v.number()),
  output: v.string(),
  sourceSha: v.string(),
});
export const workPrice = v.object({
  inputMicrosPerToken: v.number(),
  outputMicrosPerToken: v.number(),
  quotedAt: v.number(),
});
export const workStopReason = v.union(
  v.literal("time-limit"),
  v.literal("cost-limit"),
  v.literal("cancelled"),
  v.literal("infrastructure"),
);
export const findingWorkFields = {
  ownerId: v.string(),
  reviewId: v.id("reviews"),
  findingId: v.string(),
  requestId: v.string(),
  kind: v.union(v.literal("discussion"), v.literal("investigation")),
  model: v.string(),
  status: workStatus,
  attempt: v.number(),
  evidenceAttempt: v.optional(v.number()),
  dispatchGeneration: v.optional(v.number()),
  body: v.string(),
  headSha: v.string(),
  baseSha: v.string(),
  sourceOwner: v.string(),
  sourceRepo: v.string(),
  maxDurationMs: v.number(),
  maxCostMicros: v.number(),
  reservedCostMicros: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
  deadline: v.optional(v.number()),
  progress: v.string(),
  error: v.optional(v.string()),
  result: v.optional(workConclusion),
  price: v.optional(workPrice),
  checks: v.optional(v.array(workCheck)),
  proposalError: v.optional(v.string()),
  executionUnit: v.optional(v.string()),
  stopReason: v.optional(workStopReason),
};

const CHECK_OUTPUT_LIMIT = 8000;
export const clipCheckOutput = (output: string) =>
  output.length > CHECK_OUTPUT_LIMIT
    ? output.slice(0, CHECK_OUTPUT_LIMIT) +
      "\nStored output clipped at 8,000 characters."
    : output;
