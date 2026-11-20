import { fetchMutation } from "convex/nextjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getConvexAuth } from "@/lib/convex-auth";
import { inngest } from "@/inngest/client";
import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

export async function POST(request: Request) {
  const identity = await getConvexAuth();
  if (!identity)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = z
    .object({ reviewId: z.string().min(1).max(100) })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid review" }, { status: 400 });
  try {
    await fetchMutation(
      api.reviews.cancel,
      { id: parsed.data.reviewId as Id<"reviews"> },
      { token: identity.token },
    );
  } catch {
    return NextResponse.json(
      { error: "Review not found or unavailable" },
      { status: 404 },
    );
  }
  try {
    await inngest.send({
      name: "review/cancel",
      data: { reviewId: parsed.data.reviewId },
    });
  } catch {
  }
  return NextResponse.json({ success: true });
}
