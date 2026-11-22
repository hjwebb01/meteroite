import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import {
  reviewFileDiff,
  reviewResult,
  reviewFreshness,
} from "./lib/review_fields";
import { reassessmentSchema } from "./lib/review_reassessment";
import { persistedAssessmentSchema } from "./lib/review_assessment";
import {
  containsChangedLine,
  hotspotSchema,
  changeGroupSchema,
  buildHunks,
  changeHunkSchema,
} from "./lib/review_navigation";
import { getOwnedReview } from "./lib/owned_review";
import { reviewActionInput, reviewStage } from "./lib/review_stage";
import {
  completeReview,
  failReview,
  loadActiveReview,
} from "./lib/review_lifecycle";

export const get = internalQuery({
  args: { id: v.id("reviews"), ownerId: v.string() },
  handler: async (ctx, { id, ownerId }) => {
    const review = await getOwnedReview(ctx, id, ownerId);
    const previous = review.previousReviewId
      ? await ctx.db.get("reviews", review.previousReviewId)
      : null;
    const previousFiles =
      previous?.ownerId === ownerId
        ? await ctx.db
            .query("reviewFiles")
            .withIndex("by_review_filename", (q) =>
              q.eq("reviewId", previous._id),
            )
            .collect()
        : [];
    return {
      previousFiles: previousFiles.map((file) => ({
        filename: file.filename,
        previousFilename: file.previousFilename,
        status: file.status,
        headBlobSha: file.headBlobSha,
        leftBlobSha: file.leftBlobSha,
        hunks: file.hunks,
      })),
      review,
      previous: previous?.ownerId === ownerId ? previous : null,
    };
  },
});

export const status = internalQuery({
  args: { id: v.id("reviews"), ownerId: v.string() },
  handler: async (ctx, { id, ownerId }) =>
    (await getOwnedReview(ctx, id, ownerId)).status,
});

export const progress = internalMutation({
  args: {
    id: v.id("reviews"),
    progress: v.optional(v.string()),
    title: v.optional(v.string()),
    stage: v.optional(reviewStage),
    parts: v.optional(v.number()),
    action: v.optional(reviewActionInput),
    partDone: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, action, partDone, ...fields }) => {
    const review = await loadActiveReview(ctx, id);
    if (!review) return false;
    if (action)
      await ctx.db.insert("reviewActivity", {
        reviewId: id,
        stage: fields.stage ?? review.stage ?? "load",
        at: Date.now(),
        ...action,
      });
    await ctx.db.patch("reviews", id, {
      ...fields,
      ...(partDone ? { partsDone: (review.partsDone ?? 0) + 1 } : {}),
      status: "running",
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const pinSnapshot = internalMutation({
  args: {
    id: v.id("reviews"),
    title: v.string(),
    headSha: v.string(),
    baseSha: v.string(),
    baseTipSha: v.optional(v.string()),
    diffLeftSha: v.optional(v.string()),
    sourceOwner: v.string(),
    sourceRepo: v.string(),
  },
  handler: async (ctx, { id, ...snapshot }) => {
    const review = await loadActiveReview(ctx, id);
    if (!review) return false;
    if (review.headSha || review.baseSha)
      return (
        review.headSha === snapshot.headSha &&
        review.baseSha === snapshot.baseSha &&
        review.diffLeftSha === snapshot.diffLeftSha &&
        review.sourceOwner === snapshot.sourceOwner &&
        review.sourceRepo === snapshot.sourceRepo
      );
    await ctx.db.patch("reviews", id, { ...snapshot, updatedAt: Date.now() });
    return true;
  },
});

export const saveFiles = internalMutation({
  args: {
    id: v.id("reviews"),
    headSha: v.string(),
    baseSha: v.string(),
    files: v.array(reviewFileDiff),
  },
  handler: async (ctx, { id, headSha, baseSha, files }) => {
    const review = await loadActiveReview(ctx, id);
    if (!review) return;
    if (review.headSha !== headSha || review.baseSha !== baseSha)
      throw new Error("Saved diffs must match the pinned review snapshot");
    for (const file of files) {
      if (
        file.hunks &&
        JSON.stringify(
          file.hunks.map((hunk) => changeHunkSchema.parse(hunk)),
        ) !== JSON.stringify(buildHunks(file, `${headSha}:${baseSha}`))
      )
        throw new Error("Saved hunks must match the pinned text patch");
      const existing = await ctx.db
        .query("reviewFiles")
        .withIndex("by_review_filename", (q) =>
          q.eq("reviewId", id).eq("filename", file.filename),
        )
        .unique();
      if (existing)
        await ctx.db.replace("reviewFiles", existing._id, {
          reviewId: id,
          ...file,
        });
      else await ctx.db.insert("reviewFiles", { reviewId: id, ...file });
    }
  },
});

export const finish = internalMutation({
  args: { id: v.id("reviews"), result: v.object(reviewResult) },
  handler: async (ctx, { id, result }) => {
    const review = await loadActiveReview(ctx, id);
    if (!review) return;
    if (result.reassessment) {
      reassessmentSchema.parse(result.reassessment);
      if (
        result.reassessment.sourceReviewId !== review.previousReviewId ||
        result.reassessment.headSha !== review.headSha
      )
        throw new Error("Reassessment must match the pinned review lineage");
      const prior = review.previousReviewId
        ? await ctx.db.get("reviews", review.previousReviewId)
        : null;
      if (
        !prior ||
        prior.ownerId !== review.ownerId ||
        result.reassessment.sourceHeadSha !== prior.headSha ||
        result.reassessment.sourceBaseSha !== prior.baseSha
      )
        throw new Error("Reassessment must match the owned source snapshot");
      const sourceIds = {
        finding: new Set(
          prior.result?.findings.map((finding) => finding.id) ?? [],
        ),
        hotspot: new Set(
          prior.result?.hotspots?.map((hotspot) => hotspot.id) ?? [],
        ),
        group: new Set(
          prior.result?.changeGroups?.map((group) => group.id) ?? [],
        ),
      };
      if (
        result.reassessment.contexts.some(
          (context) =>
            !sourceIds[context.kind].has(context.sourceId) ||
            (context.currentId &&
              !result.findings.some(
                (finding) =>
                  finding.id === context.currentId &&
                  finding.previousFindingId === context.sourceId,
              )),
        ) ||
        result.reassessment.absentFindingIds.some(
          (findingId) => !sourceIds.finding.has(findingId),
        )
      )
        throw new Error(
          "Reassessment context must refer to its owned source review",
        );
    }
    if (result.assessment) {
      persistedAssessmentSchema.parse(result.assessment);
      if (
        result.assessment.headSha !== review.headSha ||
        result.assessment.baseSha !== review.baseSha
      )
        throw new Error("Assessment must match the pinned review snapshot");
    }
    if (result.changeGroups?.length) {
      const files = await ctx.db
        .query("reviewFiles")
        .withIndex("by_review_filename", (q) => q.eq("reviewId", id))
        .collect();
      const hunks = new Set(
        files.flatMap((file) => file.hunks?.map((hunk) => hunk.id) ?? []),
      );
      for (const group of result.changeGroups) {
        changeGroupSchema.parse(group);
        if (group.hunkIds.some((hunkId) => !hunks.has(hunkId)))
          throw new Error("Change group must match the saved hunk inventory");
      }
    }
    if (result.hotspots?.length) {
      const files = await ctx.db
        .query("reviewFiles")
        .withIndex("by_review_filename", (q) => q.eq("reviewId", id))
        .collect();
      for (const hotspot of result.hotspots) {
        hotspotSchema.parse(hotspot);
        for (const ref of hotspot.references) {
          const file = files.find((entry) => entry.filename === ref.path);
          const expectedSha =
            ref.side === "RIGHT" ? review.headSha : review.diffLeftSha;
          if (
            !ref.blobSha ||
            !file ||
            !containsChangedLine(file, ref.side, ref.line) ||
            ref.commitSha !== expectedSha ||
            ref.blobSha !==
              (ref.side === "RIGHT" ? file.headBlobSha : file.leftBlobSha) ||
            ref.sourcePath !==
              (ref.side === "LEFT"
                ? (file.previousFilename ?? file.filename)
                : file.filename)
          )
            throw new Error("Hotspot must match the saved review snapshot");
        }
      }
    }
    await completeReview(ctx, review, result);
  },
});

export const fail = internalMutation({
  args: { id: v.id("reviews"), error: v.string() },
  handler: async (ctx, { id, error }) => {
    const review = await loadActiveReview(ctx, id);
    if (!review) return;
    await failReview(ctx, review, error);
  },
});

export const recordFreshness = internalMutation({
  args: {
    id: v.id("reviews"),
    ownerId: v.string(),
    observation: reviewFreshness,
  },
  handler: async (ctx, { id, ownerId, observation }) => {
    const review = await getOwnedReview(ctx, id, ownerId);
    if (
      review.freshness &&
      review.freshness.observedAt > observation.observedAt
    )
      return;
    if (
      observation.state === "unavailable" &&
      review.freshness?.state === "outdated"
    )
      return;
    const freshness =
      observation.state === "unavailable"
        ? observation
        : {
            ...observation,
            state:
              observation.headSha === review.headSha &&
              observation.baseTipSha === (review.baseTipSha ?? review.baseSha)
                ? ("current" as const)
                : ("outdated" as const),
          };
    await ctx.db.patch("reviews", id, { freshness });
  },
});
