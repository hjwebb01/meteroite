import { v } from "convex/values";

export const reviewStage = v.union(
  v.literal("load"),
  v.literal("investigate"),
  v.literal("finish"),
);

export const MAX_REVIEW_ACTIVITY = 200;

export const reviewActivity = v.object({
  stage: reviewStage,
  tool: v.string(),
  text: v.string(),
  at: v.optional(v.number()),
  path: v.optional(v.string()),
  start: v.optional(v.number()),
  end: v.optional(v.number()),
});

export const reviewActionInput = v.object({
  tool: v.string(),
  text: v.string(),
  path: v.optional(v.string()),
  start: v.optional(v.number()),
  end: v.optional(v.number()),
});
