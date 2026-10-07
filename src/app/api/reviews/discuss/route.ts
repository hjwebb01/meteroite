import { NextResponse } from "next/server";
import { fetchMutation } from "convex/nextjs";
import { z } from "zod";
import { getConvexAuth } from "@/lib/convex-auth";
import { getGithubToken } from "@/lib/github";
import { inngest } from "@/inngest/client";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

export async function POST(request: Request) {
  const identity = await getConvexAuth();
  if (!identity)
    return NextResponse.json(
      { error: "Sign in to discuss findings." },
      { status: 401 },
    );
  const parsed = z
    .object({
      reviewId: z.string().min(1).max(100),
      findingId: z.string().min(1).max(200),
      requestId: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
      body: z.string().trim().min(1).max(4000),
    })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Enter a discussion message up to 4,000 characters." },
      { status: 400 },
    );
  if (!process.env.OPENROUTER_API_KEY || !process.env.CONVEX_DEPLOY_KEY)
    return NextResponse.json(
      { error: "The review worker needs configuration." },
      { status: 503 },
    );
  if (!(await getGithubToken(identity.userId)))
    return NextResponse.json(
      { error: "Connect GitHub to inspect more source." },
      { status: 409 },
    );
  try {
    const result = await fetchMutation(
      api.reviewInteractions.discuss,
      { ...parsed.data, reviewId: parsed.data.reviewId as Id<"reviews"> },
      { token: identity.token },
    );
    if (result.dispatch)
      await inngest.send({
        id: `finding-${result.workId}`,
        name: "review/finding.requested",
        data: {
          workId: result.workId,
          ownerId: identity.userId,
          generation: 0,
          dispatchId: `finding-${result.workId}`,
        },
      });
    return NextResponse.json({ workId: result.workId }, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not queue a response. Retry the same message.",
      },
      { status: 409 },
    );
  }
}
