import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import {
  assertLocalChatGPTRequest,
  beginChatGPTSignIn,
  disconnectChatGPT,
  getChatGPTStatus,
  setChatGPTSettings,
} from "@/features/chatgpt/lib/local-account";
import { UNAVAILABLE_CHATGPT_STATUS } from "@/features/chatgpt/lib/types";

export const runtime = "nodejs";
const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  model: z.string().min(1).optional(),
});

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertLocalChatGPTRequest(request);
    return Response.json(await getChatGPTStatus(userId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(UNAVAILABLE_CHATGPT_STATUS);
  }
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const url = await beginChatGPTSignIn(userId, request);
    if (request.headers.get("accept")?.includes("text/html")) {
      return Response.redirect(url, 303);
    }
    return Response.json({ url });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not start ChatGPT sign-in.",
      },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertLocalChatGPTRequest(request, true);
    const settings = settingsSchema.parse(await request.json());
    await setChatGPTSettings(userId, settings);
    return Response.json(await getChatGPTStatus(userId));
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not update ChatGPT settings.",
      },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    assertLocalChatGPTRequest(request, true);
    const revoked = await disconnectChatGPT(userId);
    return Response.json({ revoked });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not disconnect ChatGPT.",
      },
      { status: 400 },
    );
  }
}
