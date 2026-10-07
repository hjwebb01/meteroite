import { NextResponse } from "next/server";
import { fetchMutation } from "convex/nextjs";
import { z } from "zod";
import { getConvexAuth } from "@/lib/convex-auth";
import { inngest } from "@/inngest/client";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
export async function POST(request: Request) {
  const identity = await getConvexAuth();
  if (!identity)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = z
    .object({
      proposalId: z.string().min(1).max(100),
      expectedDigest: z.string().regex(/^[0-9a-f]{64}$/),
      requestId: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
    })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Inspect the saved proposal before applying it." },
      { status: 400 },
    );
  try {
    const result = await fetchMutation(
      api.reviewApplications.apply,
      {
        ...parsed.data,
        proposalId: parsed.data.proposalId as Id<"reviewProposals">,
      },
      { token: identity.token },
    );
    if (result.dispatch) {
      try {
        await inngest.send({
          id: `application-${result.applicationId}-${result.generation}`,
          name: "review/proposal.apply",
          data: {
            applicationId: result.applicationId,
            ownerId: identity.userId,
            generation: result.generation,
            dispatchId: `application-${result.applicationId}-${result.generation}`,
          },
        });
      } catch {
        await fetchMutation(
          api.reviewApplications.dispatchFailed,
          {
            applicationId: result.applicationId,
            generation: result.generation,
          },
          { token: identity.token },
        );
        return NextResponse.json(
          {
            error:
              "The application could not be dispatched. Retry the saved intent.",
          },
          { status: 503 },
        );
      }
    }
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Application unavailable",
      },
      { status: 409 },
    );
  }
}
