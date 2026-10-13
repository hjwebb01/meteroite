import { expect, test, vi } from "vitest";
import {
  createDiscussionSessions,
  investigationRequestFor,
} from "./discussion-session";

test("a discussion survives unsubscribe, offscreen completion, and remount without leaking to another finding", () => {
  const sessions = createDiscussionSessions();
  sessions.get("first", "openai/gpt-5");
  const listener = vi.fn();
  const unsubscribe = sessions.subscribe(listener);
  sessions.update("first", {
    body: "Check the second caller.",
    model: "custom-model",
    seconds: 90,
    dollars: 1,
    sending: true,
    pending: { body: "Check the second caller.", requestId: "same-request" },
    investigationRequest: {
      requestId: "investigation-request",
      model: "custom-model",
      maxDurationMs: 90000,
      maxCostMicros: 1000000,
    },
  });
  expect(listener).toHaveBeenCalledOnce();
  unsubscribe();
  sessions.update("first", { sending: false, error: "Connection lost" });
  const remounted = sessions.get("first", "openai/gpt-5");
  expect(remounted).toMatchObject({
    body: "Check the second caller.",
    model: "custom-model",
    seconds: 90,
    dollars: 1,
    sending: false,
    error: "Connection lost",
    pending: { requestId: "same-request" },
    investigationRequest: {
      requestId: "investigation-request",
      model: "custom-model",
      maxDurationMs: 90000,
      maxCostMicros: 1000000,
    },
  });
  expect(sessions.get("second", "openai/gpt-5").body).toBe("");
  expect(sessions.get("first", "openai/gpt-5")).toBe(remounted);
  expect(createDiscussionSessions().get("first", "openai/gpt-5").body).toBe("");
});

test("investigation retries keep identity only for unchanged parameters", () => {
  const sessions = createDiscussionSessions();
  const original = sessions.get("finding", "openai/gpt-5");
  const pending = investigationRequestFor(original);
  sessions.update("finding", { investigationRequest: pending });
  const retried = sessions.get("finding", "openai/gpt-5");
  expect(investigationRequestFor(retried)).toBe(pending);
  for (const patch of [
    { model: "changed-model" },
    { seconds: 90 },
    { dollars: 1 },
  ]) {
    const changed = investigationRequestFor({ ...retried, ...patch });
    expect(changed.requestId).not.toBe(pending.requestId);
  }
  sessions.update("finding", { investigationRequest: null });
  expect(
    investigationRequestFor(sessions.get("finding", "openai/gpt-5")).requestId,
  ).not.toBe(pending.requestId);
});
