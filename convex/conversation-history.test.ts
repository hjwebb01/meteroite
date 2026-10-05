/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { selectHistoryTurns } from "../src/features/conversations/inngest/conversation-history";

const modules = import.meta.glob("./**/*.ts");

test("completed tool summaries survive storage and reach a follow-up's history", async () => {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({ subject: "owner" });
  const projectId = await owner.mutation(api.projects.create, {
    name: "project",
  });
  const conversationId = await owner.mutation(api.conversations.create, {
    projectId,
    title: "history",
  });
  const previous = await owner.mutation(api.conversations.startMessage, {
    conversationId,
    message: "Change src/app.ts",
  });
  const progressSteps = [
    { label: "Updated src/app.ts", status: "complete" as const },
  ];
  await t.mutation(internal.systemMessages.updateMessageProgress, {
    messageId: previous.assistantMessageId,
    progressSteps,
  });
  const turnSummary = {
    filesRead: ["src/app.ts"],
    filesChanged: [{ action: "updated" as const, path: "src/app.ts" }],
    findings: [],
  };
  await t.mutation(internal.systemMessages.updateMessageContent, {
    messageId: previous.assistantMessageId,
    content: "Done.",
    turnSummary,
  });
  const stored = await t.run((ctx) => ctx.db.get(previous.assistantMessageId));
  expect(stored?.turnSummary).toEqual(turnSummary);
  expect(stored?.progressSteps).toEqual(progressSteps);

  const current = await owner.mutation(api.conversations.startMessage, {
    conversationId,
    message: "Undo that change",
  });
  const recent = await t.query(internal.systemMessages.getRecentMessages, {
    conversationId,
    limit: 3,
  });
  expect(recent.map((m) => m._id)).toEqual([
    previous.assistantMessageId,
    current.userMessageId,
    current.assistantMessageId,
  ]);
  expect(recent.every((m) => !("progressSteps" in m))).toBe(true);
  const turns = selectHistoryTurns(recent, {
    excludeIds: new Set([current.userMessageId, current.assistantMessageId]),
  });
  expect(turns).toHaveLength(1);
  expect(turns[0]?.role).toBe("assistant");
  expect(turns[0]?.content).toContain("updated src/app.ts");
});
