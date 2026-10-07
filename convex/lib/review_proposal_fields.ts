import { v } from "convex/values";
import { workCheck, workConclusion } from "./review_work_fields";
export const proposalFile = v.object({
  path: v.string(),
  expectedBlobSha: v.union(v.string(), v.null()),
  original: v.union(v.string(), v.null()),
  replacement: v.union(v.string(), v.null()),
});
export const proposalFields = {
  ownerId: v.string(),
  reviewId: v.id("reviews"),
  findingId: v.string(),
  workId: v.id("reviewFindingWork"),
  attempt: v.number(),
  sourceSha: v.string(),
  sourceOwner: v.string(),
  sourceRepo: v.string(),
  sourceBranch: v.string(),
  digest: v.string(),
  files: v.array(proposalFile),
  rationale: v.string(),
  investigation: workConclusion,
  checks: v.array(workCheck),
  createdAt: v.number(),
};
