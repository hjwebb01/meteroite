/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { DEFAULT_CODING_MODEL_ID } from "./lib/coding_models";

const modules = import.meta.glob("./**/*.ts");

const setup = async () => {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice" });
  const bob = t.withIdentity({ subject: "bob" });
  const projectId = await alice.mutation(api.projects.create, {
    name: "alice-project",
  });
  return { alice, bob, projectId };
};

describe("conversation model", () => {
  test("new conversations store the chosen model and reject unknown ones", async () => {
    const { alice, projectId } = await setup();

    const id = await alice.mutation(api.conversations.create, {
      projectId,
      title: "chat",
      model: "z-ai/glm-5.3-flash",
    });
    const conversation = await alice.query(api.conversations.getById, { id });
    expect(conversation.model).toBe("z-ai/glm-5.3-flash");

    await expect(
      alice.mutation(api.conversations.create, {
        projectId,
        title: "chat",
        model: "openai/not-a-model",
      }),
    ).rejects.toThrow(/Unsupported model/);
  });

  test("setModel is owner-only and validates the id", async () => {
    const { alice, bob, projectId } = await setup();
    const id = await alice.mutation(api.conversations.create, {
      projectId,
      title: "chat",
    });

    await alice.mutation(api.conversations.setModel, {
      id,
      model: "deepseek/deepseek-v4.1-flash",
    });
    expect((await alice.query(api.conversations.getById, { id })).model).toBe(
      "deepseek/deepseek-v4.1-flash",
    );
    await expect(
      alice.mutation(api.conversations.setModel, { id, model: "nope" }),
    ).rejects.toThrow(/Unsupported model/);
    await expect(
      bob.mutation(api.conversations.setModel, {
        id,
        model: "deepseek/deepseek-v4.1-flash",
      }),
    ).rejects.toThrow(/Unauthorized/);
  });

  test("startMessage returns the turn's model and remembers an explicit choice", async () => {
    const { alice, projectId } = await setup();
    const id = await alice.mutation(api.conversations.create, {
      projectId,
      title: "chat",
    });

    const unset = await alice.mutation(api.conversations.startMessage, {
      conversationId: id,
      message: "hi",
    });
    expect(unset.model).toBe(DEFAULT_CODING_MODEL_ID);

    const chosen = await alice.mutation(api.conversations.startMessage, {
      conversationId: id,
      message: "again",
      model: "z-ai/glm-5.3-flash",
    });
    expect(chosen.model).toBe("z-ai/glm-5.3-flash");

    const remembered = await alice.mutation(api.conversations.startMessage, {
      conversationId: id,
      message: "and again",
    });
    expect(remembered.model).toBe("z-ai/glm-5.3-flash");

    await expect(
      alice.mutation(api.conversations.startMessage, {
        conversationId: id,
        message: "bad",
        model: "nope",
      }),
    ).rejects.toThrow(/Unsupported model/);
  });
});
