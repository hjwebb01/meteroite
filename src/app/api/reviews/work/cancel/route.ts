import { NextResponse } from "next/server";
import { fetchMutation } from "convex/nextjs";
import { z } from "zod";
import { getConvexAuth } from "@/lib/convex-auth";
import { inngest } from "@/inngest/client";
import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { stopIsolatedExecution } from "@/features/reviews/lib/execution-provider";
export async function POST(request: Request) {
  const identity = await getConvexAuth();
  if (!identity)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = z
    .object({ workId: z.string().min(1).max(100) })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid work" }, { status: 400 });
  let generation = 0;
  let executionStopped: boolean | null = null;
  try {
    const result = await fetchMutation(
      api.reviewInteractions.cancel,
      { workId: parsed.data.workId as Id<"reviewFindingWork"> },
      { token: identity.token },
    );
    generation = result.generation;
    if (result.executionUnit)
      executionStopped = await stopIsolatedExecution(result.executionUnit);
  } catch {
    return NextResponse.json({ error: "Work not found" }, { status: 404 });
  }
  try {
    await inngest.send({
      name: "review/finding.cancelled",
      data: { workId: parsed.data.workId, generation },
    });
  } catch {}
  return NextResponse.json({ success: true, executionStopped });
}
