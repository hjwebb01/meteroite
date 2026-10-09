import { auth } from "@clerk/nextjs/server";
import {
  completeChatGPTSignIn,
  getChatGPTCallbackRedirect,
} from "@/features/chatgpt/lib/local-account";

export const runtime = "nodejs";

export async function GET(request: Request) {
  let success = false;
  let message =
    "ChatGPT is connected. You can close this tab and return to Meteroite.";
  try {
    const destination = await getChatGPTCallbackRedirect(request);
    if (destination)
      return new Response(null, {
        status: 303,
        headers: {
          Location: destination,
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      });
    const { userId } = await auth();
    if (!userId)
      throw new Error(
        "Sign in to Meteroite in the original browser, then connect ChatGPT again.",
      );
    await completeChatGPTSignIn(request, userId);
    success = true;
  } catch (error) {
    message =
      error instanceof Error
        ? error.message
        : "ChatGPT sign-in failed. Return to Meteroite and try again.";
  }
  const escaped = message.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ChatGPT connection · Meteroite</title><body><main><h1>${success ? "ChatGPT connected" : "Could not connect ChatGPT"}</h1><p>${escaped}</p></main></body></html>`,
    {
      status: success ? 200 : 400,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      },
    },
  );
}
