import { NextResponse } from "next/server";
import { z } from "zod";
import { getConvexAuth } from "@/lib/convex-auth";
import { getGithubToken } from "@/lib/github";
import { getConvexAdminClient } from "@/lib/convex-client";
import { inngest } from "@/inngest/client";
import { internal } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { executionCapability } from "@/features/reviews/lib/execution-provider";
import {
  FindingPriceError,
  quoteFindingModel,
} from "@/features/reviews/lib/finding-budget";
import { refusalResponse } from "@/features/reviews/lib/refusal";
import {
  isCodingModelId,
  DEFAULT_CODING_MODEL_ID,
} from "../../../../../convex/lib/coding_models";
export async function GET() {
  if (!(await getConvexAuth()))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await executionCapability());
}
export async function POST(request: Request) {
  const identity = await getConvexAuth();
  if (!identity)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = z
    .object({
      reviewId: z.string().min(1).max(100),
      findingId: z.string().min(1).max(200),
      requestId: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
      model: z
        .string()
        .refine(isCodingModelId)
        .default(DEFAULT_CODING_MODEL_ID),
      maxDurationMs: z.number().int().min(30_000).max(300_000),
      maxCostMicros: z.number().int().min(100_000).max(10_000_000),
    })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      {
        error:
          "Choose a supported model and limits of 30–300 seconds and $0.10–$10.",
      },
      { status: 400 },
    );
  if (!(await getGithubToken(identity.userId)))
    return NextResponse.json(
      { error: "Connect GitHub to investigate the pinned checkout." },
      { status: 409 },
    );
  try {
    const price = await quoteFindingModel(parsed.data.model);
    const result = await getConvexAdminClient().mutation(
      internal.reviewFindingJobs.investigate,
      {
        ...parsed.data,
        reviewId: parsed.data.reviewId as Id<"reviews">,
        ownerId: identity.userId,
        price,
      },
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
    if (error instanceof FindingPriceError)
      return NextResponse.json({ error: error.message }, { status: 409 });
    return refusalResponse(error, "Investigation could not start. Try again.");
  }
}
