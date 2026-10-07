import { applicationFields } from "./lib/review_application_fields";
import { proposalFields } from "./lib/review_proposal_fields";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  reviewFileDiff,
  reviewResult,
  reviewFreshness,
} from "./lib/review_fields";
import {
  findingWorkFields,
  workConclusion,
  workCheck,
  workStatus,
  workStopReason,
} from "./lib/review_work_fields";

export default defineSchema({
  reviews: defineTable({
    ownerId: v.string(),
    url: v.string(),
    repoOwner: v.string(),
    repoName: v.string(),
    pullNumber: v.number(),
    model: v.string(),
    instructions: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    progress: v.string(),
    updatedAt: v.number(),
    title: v.optional(v.string()),
    headSha: v.optional(v.string()),
    freshness: v.optional(reviewFreshness),
    baseSha: v.optional(v.string()),
    baseTipSha: v.optional(v.string()),
    diffLeftSha: v.optional(v.string()),
    sourceOwner: v.optional(v.string()),
    sourceRepo: v.optional(v.string()),
    previousReviewId: v.optional(v.id("reviews")),
    error: v.optional(v.string()),
    result: v.optional(v.object(reviewResult)),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_url", ["ownerId", "url"]),

  reviewGroupingFeedback: defineTable({
    reviewId: v.id("reviews"),
    ownerId: v.string(),
    groupId: v.string(),
    requestId: v.string(),
    reason: v.string(),
    createdAt: v.number(),
  })
    .index("by_review", ["reviewId"])
    .index("by_owner_request", ["ownerId", "requestId"]),

  // The diff each review was run against, one document per changed file.
  reviewFiles: defineTable({
    reviewId: v.id("reviews"),
    ...reviewFileDiff.fields,
  }).index("by_review_filename", ["reviewId", "filename"]),

  reviewMessages: defineTable({
    reviewId: v.id("reviews"),
    findingId: v.string(),
    workId: v.id("reviewFindingWork"),
    attempt: v.optional(v.number()),
    role: v.union(v.literal("user"), v.literal("assistant")),
    body: v.string(),
    conclusion: v.optional(workConclusion),
    createdAt: v.number(),
  })
    .index("by_finding", ["reviewId", "findingId"])
    .index("by_work_role", ["workId", "role"]),
  reviewFindingWork: defineTable(findingWorkFields)
    .index("by_finding", ["reviewId", "findingId"])
    .index("by_owner_request", ["ownerId", "requestId"])
    .index("by_status_updated", ["status", "updatedAt"]),

  reviewFindingAttempts: defineTable({
    ownerId: v.string(),
    reviewId: v.id("reviews"),
    findingId: v.string(),
    workId: v.id("reviewFindingWork"),
    attempt: v.number(),
    status: workStatus,
    checks: v.array(workCheck),
    result: v.optional(workConclusion),
    proposalError: v.optional(v.string()),
    stopReason: v.optional(workStopReason),
    reservedCostMicros: v.number(),
    deadline: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_finding", ["reviewId", "findingId"])
    .index("by_work_attempt", ["workId", "attempt"]),

  reviewProposals: defineTable(proposalFields)
    .index("by_finding", ["reviewId", "findingId"])
    .index("by_work_attempt", ["workId", "attempt"]),

  reviewApplications: defineTable(applicationFields)
    .index("by_proposal", ["proposalId"])
    .index("by_owner_request", ["ownerId", "requestId"])
    .index("by_status_updated", ["status", "updatedAt"]),

  projects: defineTable({
    name: v.string(),
    ownerId: v.string(),
    updatedAt: v.number(),
    importStatus: v.optional(
      v.union(
        v.literal("importing"),
        v.literal("completed"),
        v.literal("failed"),
      ),
    ),
    exportStatus: v.optional(
      v.union(
        v.literal("exporting"),
        v.literal("completed"),
        v.literal("failed"),
        v.literal("cancelled"),
      ),
    ),
    exportRepoUrl: v.optional(v.string()),
    /** Identifies the active export run so stale runs cannot overwrite its status. */
    exportJobId: v.optional(v.string()),
    settings: v.optional(
      v.object({
        installCommand: v.optional(v.string()),
        devCommand: v.optional(v.string()),
      }),
    ),
  }).index("by_owner", ["ownerId"]),

  files: defineTable({
    projectId: v.id("projects"),
    parentId: v.optional(v.id("files")),
    name: v.string(),
    type: v.union(v.literal("file"), v.literal("folder")),
    content: v.optional(v.string()), // Text files only
    storageId: v.optional(v.id("_storage")), // Binary files only
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_parent", ["parentId"])
    .index("by_project_parent", ["projectId", "parentId"]),

  conversations: defineTable({
    projectId: v.id("projects"),
    title: v.string(),
    model: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_project", ["projectId"]),

  messages: defineTable({
    conversationId: v.id("conversations"),
    projectId: v.id("projects"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    status: v.optional(
      v.union(
        v.literal("processing"),
        v.literal("completed"),
        v.literal("cancelled"),
      ),
    ),
    progressLabel: v.optional(v.string()),
    progressSteps: v.optional(
      v.array(
        v.object({
          id: v.optional(v.string()),
          label: v.string(),
          description: v.optional(v.string()),
          status: v.optional(
            v.union(
              v.literal("pending"),
              v.literal("active"),
              v.literal("complete"),
              v.literal("error"),
            ),
          ),
          kind: v.optional(v.union(v.literal("phase"), v.literal("tool"))),
          toolName: v.optional(v.string()),
        }),
      ),
    ),
    /** Compact record of what an assistant turn read/changed, replayed as history. */
    turnSummary: v.optional(
      v.object({
        filesRead: v.array(v.string()),
        filesChanged: v.array(
          v.object({
            action: v.union(
              v.literal("created"),
              v.literal("updated"),
              v.literal("deleted"),
              v.literal("renamed"),
              v.literal("folder"),
            ),
            path: v.string(),
            fileId: v.optional(v.string()),
          }),
        ),
        findings: v.array(v.string()),
      }),
    ),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_project_status", ["projectId", "status"]),
});
