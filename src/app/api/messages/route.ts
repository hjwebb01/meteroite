import { z } from "zod";
import { NextResponse } from "next/server";
import { fetchMutation } from "convex/nextjs";
import { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import { getConvexAuth } from "@/lib/convex-auth";
import { inngest } from "@/inngest/client";
import { isCodingModelId } from "../../../../convex/lib/coding-models";

const requestSchema = z.object({
  conversationId: z.string(),
  message: z.string(),
  model: z
    .string()
    .refine(isCodingModelId, { message: "Unsupported model" })
    .optional(),
});

export async function POST(request: Request) {
  const convexAuth = await getConvexAuth();

  if (!convexAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { conversationId, message, model: requestedModel } = parsed.data;

  // Runs as the user, so Convex rejects conversations they don't own.
  const {
    projectId,
    userMessageId,
    assistantMessageId,
    cancelledMessageIds,
    model,
  } = await fetchMutation(
    api.conversations.startMessage,
    {
      conversationId: conversationId as Id<"conversations">,
      message,
      model: requestedModel,
    },
    { token: convexAuth.token },
  );

  if (cancelledMessageIds.length > 0) {
    await inngest.send(
      cancelledMessageIds.map((messageId) => ({
        name: "message/cancel",
        data: { messageId },
      })),
    );
  }

  const event = await inngest.send({
    name: "message/sent",
    data: {
      messageId: assistantMessageId,
      userMessageId,
      conversationId,
      projectId,
      message,
      model,
    },
  });

  return NextResponse.json({
    success: true,
    eventId: event.ids[0],
    messageId: assistantMessageId,
  });
}
