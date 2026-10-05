// @vitest-environment node
import { ConvexHttpClient } from "convex/browser";
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { getConvexAdminClient } from "./convex-client";

vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Convex admin client", () => {
  test("requires a deployment key before creating a client", () => {
    vi.stubEnv("CONVEX_DEPLOY_KEY", "");
    expect(() => getConvexAdminClient()).toThrow(
      "CONVEX_DEPLOY_KEY is not configured",
    );
  });

  test("authenticates internal calls without putting the key in arguments or other clients", async () => {
    vi.stubEnv("CONVEX_DEPLOY_KEY", "test-deploy-key");
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");
    const fetch = vi.fn(async () =>
      Response.json({ status: "success", value: null }),
    );
    vi.stubGlobal("fetch", fetch);

    await getConvexAdminClient().query(
      internal.systemMessages.getConversationById,
      { conversationId: "conversation" as Id<"conversations"> },
    );
    const adminRequest = fetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(new Headers(adminRequest[1].headers).get("Authorization")).toBe(
      "Convex test-deploy-key",
    );
    expect(JSON.parse(String(adminRequest[1].body))).toMatchObject({
      path: "systemMessages:getConversationById",
      args: [{ conversationId: "conversation" }],
    });
    expect(String(adminRequest[1].body)).not.toContain("test-deploy-key");

    await getConvexAdminClient().mutation(
      internal.systemMessages.updateMessageContent,
      { messageId: "message" as Id<"messages">, content: "done" },
    );
    const mutationRequest = fetch.mock.calls[1] as unknown as [
      string,
      RequestInit,
    ];
    expect(new Headers(mutationRequest[1].headers).get("Authorization")).toBe(
      "Convex test-deploy-key",
    );

    const publicClient = new ConvexHttpClient(
      process.env.NEXT_PUBLIC_CONVEX_URL!,
    );
    await publicClient.query(api.projects.get, {});
    const publicRequest = fetch.mock.calls[2] as unknown as [
      string,
      RequestInit,
    ];
    expect(
      new Headers(publicRequest[1].headers).get("Authorization"),
    ).toBeNull();
  });
});
