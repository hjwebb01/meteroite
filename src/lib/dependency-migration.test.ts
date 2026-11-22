// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/convex-client", () => ({ getConvexAdminClient: () => ({}) }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("dependency migration integration", () => {
  it("registers the review jobs, cancellation filters, and failure handlers with Inngest 4", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    let registration:
      | {
          functions: Array<{
            id: string;
            triggers: unknown[];
            cancel?: unknown[];
          }>;
        }
      | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, options?: RequestInit) => {
        if (options?.method === "POST") {
          registration = JSON.parse(String(options.body));
        }
        return Response.json({ status: 200, modified: true });
      }),
    );
    const { PUT } = await import("@/app/api/inngest/route");
    const response = await PUT(
      new NextRequest("http://localhost:3000/api/inngest", {
        method: "PUT",
      }),
      undefined,
    );
    expect(response.status).toBe(200);
    expect(registration).toBeDefined();
    const functions = registration!.functions;
    expect(functions.filter((fn) => fn.id.endsWith("-failure"))).toHaveLength(
      3,
    );
    expect(
      functions.find((fn) => fn.id === "meteroite-review-pull-request")
        ?.triggers,
    ).toEqual([{ event: "review/requested" }]);
    expect(
      functions.find((fn) => fn.id === "meteroite-review-pull-request")?.cancel,
    ).toEqual([
      expect.objectContaining({
        event: "review/cancel",
        if: "event.data.reviewId == async.data.reviewId",
      }),
    ]);
  });
});
