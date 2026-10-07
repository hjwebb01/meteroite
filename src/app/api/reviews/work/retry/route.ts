import { NextResponse } from "next/server";
import { fetchMutation } from "convex/nextjs";
import { z } from "zod";
import { getConvexAuth } from "@/lib/convex-auth";
import { inngest } from "@/inngest/client";
import { refusalResponse } from "@/features/reviews/lib/refusal";
import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
export async function POST(request: Request) {
  const identity = await getConvexAuth();
  if (!identity)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = z
    .object({ workId: z.string().min(1).max(100) })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid work" }, { status: 400 });
  try {
    const result = await fetchMutation(
      api.reviewInteractions.retry,
      { workId: parsed.data.workId as Id<"reviewFindingWork"> },
      { token: identity.token },
    );
    const dispatchId = `finding-${result.workId}-retry-${result.attempt}`;
    await inngest.send({
      id: dispatchId,
      name: "review/finding.requested",
      data: {
        workId: result.workId,
        ownerId: identity.userId,
        generation: result.generation,
        dispatchId,
      },
    });
    return NextResponse.json({ workId: result.workId }, { status: 202 });
  } catch (error) {
    return refusalResponse(error, "Retry unavailable. Try again.");
  }
}
