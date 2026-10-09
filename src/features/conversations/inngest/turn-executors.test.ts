// @vitest-environment node
import {
  Agent,
  createAgent,
  createNetwork,
  type NetworkRun,
  type StateData,
  type TextMessage,
} from "@inngest/agent-kit";
import { NonRetriableError } from "inngest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { Step } from "./chatgpt-agent";
import type { HistoryTurn } from "./conversation-history";
import {
  CHATGPT_PROVIDER_ERROR_NAME,
  createCodingRouter,
  createTurnExecutor,
} from "./turn-executors";

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  networkRun: vi.fn(),
}));
vi.mock("@/features/chatgpt/lib/responses", async (original) => ({
  ...(await original<typeof import("@/features/chatgpt/lib/responses")>()),
  completeChatGPTResponse: mocks.complete,
}));
vi.mock("@/lib/convex-client", () => ({ getConvexAdminClient: vi.fn() }));
vi.mock("@inngest/agent-kit", async (original) => {
  const actual = await original<typeof import("@inngest/agent-kit")>();
  return { ...actual, createNetwork: vi.fn(actual.createNetwork) };
});

const projectId = "project-1" as Id<"projects">;
const reporter = {
  toolStart: vi.fn(),
  toolEnd: vi.fn(),
} as never;
const history: HistoryTurn[] = [{ role: "assistant", content: "Earlier" }];
const chatGPT = { userId: "user", connectionId: "connection", model: "m" };
const step = {
  run: async (_name: string, execute: () => unknown) => execute(),
} as unknown as Step;

const assistant = (content: TextMessage["content"]): TextMessage => ({
  type: "text",
  role: "assistant",
  content,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("OpenRouter turn executor", () => {
  beforeEach(() => {
    vi.mocked(createNetwork).mockImplementation(
      (options) =>
        ({
          run: async (message: string) => mocks.networkRun(options, message),
        }) as never,
    );
  });
  afterEach(() => {
    vi.mocked(createNetwork).mockReset();
  });

  const openRouter = () =>
    createTurnExecutor({
      provider: { kind: "openrouter" },
      model: "openai/gpt-6-luna",
      step,
      projectId,
      reporter,
      historyTurns: history,
    });

  it("returns the last assistant text and every network result", async () => {
    const results = [{ output: [] }, { output: [assistant("Done")] }];
    mocks.networkRun.mockResolvedValue({
      state: { results: results as never },
    });

    const turn = await openRouter().runTurn("Change it");

    expect(turn).toEqual({ text: "Done", results });
    expect(mocks.networkRun).toHaveBeenCalledWith(
      expect.objectContaining({ maxIter: 7 }),
      "Change it",
    );
  });

  it("falls back to a fixed reply when the loop ends without text", async () => {
    mocks.networkRun.mockResolvedValue({ state: { results: [] } });

    const turn = await openRouter().runTurn("Change it");

    expect(turn.text).toBe(
      "I processed your request. Let me know if you need anything else.",
    );
    expect(turn.results).toEqual([]);
  });

  it("stops after the same tool call repeats twice, and after a text answer", () => {
    const router = createCodingRouter(
      createAgent({ name: "meteroite", system: "Help" }),
    );
    const toolRound = {
      output: [
        {
          type: "tool_call",
          tool: { name: "editFile", input: { path: "a" } },
        },
      ],
    };
    const network = (results: unknown[]) =>
      ({ state: { results } }) as unknown as NetworkRun<StateData>;

    expect(router({ network: network([toolRound]) })).toBeDefined();
    expect(router({ network: network([toolRound]) })).toBeDefined();
    expect(router({ network: network([toolRound]) })).toBeUndefined();
    expect(
      router({ network: network([{ output: [assistant("Answer")] }]) }),
    ).toBeUndefined();
  });

  it("generates titles from plain text output of the title agent", async () => {
    const run = vi.spyOn(Agent.prototype, "run").mockResolvedValue({
      output: [
        assistant([
          { type: "text", text: "Fix login" },
          { type: "text", text: " flow" },
        ]),
      ],
    } as never);

    await expect(openRouter().generateTitle("login bug")).resolves.toBe(
      "Fix login flow",
    );
    run.mockRestore();
  });
});

describe("ChatGPT turn executor", () => {
  it("generates titles through a durable step and retains the non-retriable failure policy", async () => {
    const names: string[] = [];
    const executor = createTurnExecutor({
      provider: { kind: "chatgpt", selection: chatGPT },
      step: {
        run: async (name: string, execute: () => unknown) => {
          names.push(name);
          return execute();
        },
      } as unknown as Step,
      projectId,
      reporter,
      historyTurns: [],
    });
    mocks.complete.mockResolvedValueOnce({
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Login fix" }],
        },
      ],
    });

    await expect(executor.generateTitle("login bug")).resolves.toBe(
      "Login fix",
    );
    expect(names).toEqual(["chatgpt-title"]);
    expect(mocks.networkRun).not.toHaveBeenCalled();

    mocks.complete.mockRejectedValueOnce(new Error("Plan usage exhausted"));
    const failure = executor.generateTitle("login bug");
    await expect(failure).rejects.toThrow("Plan usage exhausted");
    const title = executor.failure(new Error("Plan usage exhausted"), "title");
    expect(title).toBeInstanceOf(NonRetriableError);
    expect(title).toMatchObject({ name: CHATGPT_PROVIDER_ERROR_NAME });
    await expect(failure).rejects.toThrow("Plan usage exhausted");
  });

  it("runs the turn with the coding tools and retains the non-retriable failure policy", async () => {
    const executor = createTurnExecutor({
      provider: { kind: "chatgpt", selection: chatGPT },
      step,
      projectId,
      reporter,
      historyTurns: history,
    });
    mocks.complete.mockResolvedValueOnce({
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "All set" }],
        },
      ],
    });

    await expect(executor.runTurn("Change it")).resolves.toEqual({
      text: "All set",
      results: [],
    });
    expect(mocks.complete.mock.calls[0]![1]).toMatchObject({
      instructions: expect.any(String),
      input: [
        { role: "assistant", content: "Earlier" },
        { role: "user", content: "Change it" },
      ],
      tools: [{ type: "namespace", name: "meteroite" }],
    });
    expect(mocks.networkRun).not.toHaveBeenCalled();

    mocks.complete.mockRejectedValueOnce(new Error("Socket closed"));
    await expect(executor.runTurn("Again")).rejects.toThrow("Socket closed");
    const turn = executor.failure(new Error("Socket closed"), "turn");
    expect(turn).toBeInstanceOf(NonRetriableError);
    expect(turn).toMatchObject({ name: CHATGPT_PROVIDER_ERROR_NAME });
  });
});
