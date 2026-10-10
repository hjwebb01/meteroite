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

  test("names a deploy key that belongs to a different deployment", () => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");
    vi.stubEnv("CONVEX_DEPLOY_KEY", "preview:team:project|secret");
    expect(() => getConvexAdminClient()).toThrow(
      'not a deploy key for example (it starts with "preview:team:project")',
    );
    vi.stubEnv("CONVEX_DEPLOY_KEY", "dev:other|secret");
    expect(() => getConvexAdminClient()).toThrow("not a deploy key for example");
  });

  test("authenticates internal calls without putting the key in arguments or other clients", async () => {
    vi.stubEnv("CONVEX_DEPLOY_KEY", "dev:example|test-deploy-key");
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");
    const fetch = vi.fn(async () =>
      Response.json({ status: "success", value: null }),
    );
    vi.stubGlobal("fetch", fetch);

    await getConvexAdminClient().query(
      internal.reviewJobs.status,
      { id: "review" as Id<"reviews">, ownerId: "owner" },
    );
    const adminRequest = fetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(new Headers(adminRequest[1].headers).get("Authorization")).toBe(
      "Convex dev:example|test-deploy-key",
    );
    expect(JSON.parse(String(adminRequest[1].body))).toMatchObject({
      path: "reviewJobs:status",
      args: [{ id: "review", ownerId: "owner" }],
    });
    expect(String(adminRequest[1].body)).not.toContain("test-deploy-key");

    await getConvexAdminClient().mutation(
      internal.reviewJobs.progress,
      { id: "review" as Id<"reviews">, progress: "done" },
    );
    const mutationRequest = fetch.mock.calls[1] as unknown as [
      string,
      RequestInit,
    ];
    expect(new Headers(mutationRequest[1].headers).get("Authorization")).toBe(
      "Convex dev:example|test-deploy-key",
    );

    const publicClient = new ConvexHttpClient(
      process.env.NEXT_PUBLIC_CONVEX_URL!,
    );
    await publicClient.query(api.reviews.list, {});
    const publicRequest = fetch.mock.calls[2] as unknown as [
      string,
      RequestInit,
    ];
    expect(
      new Headers(publicRequest[1].headers).get("Authorization"),
    ).toBeNull();
  });
});
