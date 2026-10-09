// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { Step } from "./chatgpt-agent";
import { completeTurn } from "./complete-turn";

const mocks = vi.hoisted(() => ({ mutation: vi.fn() }));
vi.mock("@/lib/convex-client", () => ({
  getConvexAdminClient: () => ({ mutation: mocks.mutation }),
}));

const messageId = "message-1" as Id<"messages">;
const steps: string[] = [];
const step = {
  run: async (name: string, execute: () => unknown) => {
    steps.push(name);
    return execute();
  },
} as unknown as Step;
const reporter = { finalizeResponse: vi.fn().mockResolvedValue(undefined) };

beforeEach(() => {
  vi.clearAllMocks();
  steps.length = 0;
});

describe("completeTurn", () => {
  it("finalizes progress, then saves the reply with its turn summary", async () => {
    await completeTurn({
      step,
      reporter,
      messageId,
      turn: {
        text: "Updated the file.",
        results: [
          {
            toolCalls: [
              {
                tool: { name: "editFile", input: { path: "src/app.ts" } },
                content: '{"path":"src/app.ts","action":"updated"}',
              },
            ],
          },
        ],
      },
    });

    expect(steps).toEqual(["progress-finalizing", "update-assistant-message"]);
    expect(reporter.finalizeResponse).toHaveBeenCalledOnce();
    expect(mocks.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        messageId,
        content: "Updated the file.",
        turnSummary: expect.objectContaining({
          filesChanged: [{ action: "updated", path: "src/app.ts" }],
        }),
      }),
    );
  });

  it("omits the turn summary when the turn touched nothing", async () => {
    await completeTurn({
      step,
      reporter,
      messageId,
      turn: { text: "Just an answer.", results: [] },
    });

    expect(mocks.mutation).toHaveBeenCalledWith(expect.anything(), {
      messageId,
      content: "Just an answer.",
    });
  });
});
