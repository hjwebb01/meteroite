import { z } from "zod";
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  adjectives,
  animals,
  colors,
  uniqueNamesGenerator,
} from "unique-names-generator";

import { DEFAULT_CONVERSATION_TITLE } from "../../../../../convex/constants";

import { inngest } from "@/inngest/client";
import { getConvexAdminClient } from "@/lib/convex-client";

import { internal } from "../../../../../convex/_generated/api";

const requestSchema = z.object({
  prompt: z.string().min(1),
});

export async function POST(request: Request) {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const deployKey = process.env.CONVEX_DEPLOY_KEY;

  if (!deployKey) {
    return NextResponse.json(
      { error: "CONVEX_DEPLOY_KEY not configured" },
      { status: 500 },
    );
  }

  const body = await request.json();
  const { prompt } = requestSchema.parse(body);

  // Generate a random project name
  const projectName = uniqueNamesGenerator({
    dictionaries: [adjectives, animals, colors],
    separator: "-",
    length: 3,
  });

  // Create project and conversation together
  const { projectId, conversationId } = await getConvexAdminClient().mutation(
    internal.importExport.createProjectWithConversation,
    {
      projectName,
      conversationTitle: DEFAULT_CONVERSATION_TITLE,
      ownerId: userId,
    },
  );

  const userMessageId = await getConvexAdminClient().mutation(
    internal.systemMessages.createMessage,
    {
      conversationId,
      projectId,
      role: "user",
      content: prompt,
    },
  );

  // Create assistant message placeholder with processing status
  const assistantMessageId = await getConvexAdminClient().mutation(
    internal.systemMessages.createMessage,
    {
      conversationId,
      projectId,
      role: "assistant",
      content: "",
      status: "processing",
    },
  );

  // Trigger Inngest to process the message
  await inngest.send({
    name: "message/sent",
    data: {
      messageId: assistantMessageId,
      userMessageId,
      conversationId,
      projectId,
      message: prompt,
    },
  });

  return NextResponse.json({ projectId });
}
