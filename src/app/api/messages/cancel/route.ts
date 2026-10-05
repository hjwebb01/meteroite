import { z } from "zod";
import { NextResponse } from "next/server";
import { fetchMutation } from "convex/nextjs";
import { getConvexAuth } from "@/lib/convex-auth";
import { api } from "../../../../../convex/_generated/api";
import { inngest } from "@/inngest/client";
import { Id } from "../../../../../convex/_generated/dataModel";

const requestSchema = z.object({
  projectId: z.string(),
});

export async function POST(request: Request) {
  const convexAuth = await getConvexAuth();
  if (!convexAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json();
  const { projectId } = requestSchema.parse(body);

  const cancelledIds = await fetchMutation(
    api.conversations.cancelProcessingMessages,
    { projectId: projectId as Id<"projects"> },
    { token: convexAuth.token },
  );

  if (cancelledIds.length === 0) {
    return NextResponse.json({ success: true, cancelled: false });
  }

  await inngest.send(
    cancelledIds.map((messageId) => ({
      name: "message/cancel",
      data: { messageId },
    })),
  );

  return NextResponse.json({
    success: true,
    cancelled: true,
    messageIds: cancelledIds,
  });
}
