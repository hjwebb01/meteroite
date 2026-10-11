import { expect, test } from "vitest";
import { v } from "convex/values";
import { z } from "zod";
import { zodValidator } from "./zod_validator";

test("derives the stored shape and drops bounds and refinements", () => {
  const schema = z
    .discriminatedUnion("state", [
      z.object({
        state: z.literal("complete"),
        score: z.union([z.literal(1), z.literal(2)]),
        side: z.enum(["LEFT", "RIGHT"]),
        tags: z.array(z.string().min(1)).max(3),
        note: z.string().max(10).optional(),
        parent: z.string().nullable(),
        draft: z.boolean(),
      }),
      z.object({ state: z.literal("incomplete"), at: z.number().int() }),
    ])
    .superRefine(() => {});
  expect(zodValidator(schema)).toEqual(
    v.union(
      v.object({
        state: v.literal("complete"),
        score: v.union(v.literal(1), v.literal(2)),
        side: v.union(v.literal("LEFT"), v.literal("RIGHT")),
        tags: v.array(v.string()),
        note: v.optional(v.string()),
        parent: v.union(v.string(), v.null()),
        draft: v.boolean(),
      }),
      v.object({ state: v.literal("incomplete"), at: v.number() }),
    ),
  );
});

test("a shape Convex cannot store fails at definition time", () => {
  expect(() => zodValidator(z.object({ at: z.date() }))).toThrow(/date/);
});
