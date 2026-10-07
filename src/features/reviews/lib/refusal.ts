import { NextResponse } from "next/server";
import { ConvexError } from "convex/values";

// A refusal is an error written for the user: a ConvexError carrying its
// message. Anything else is an infrastructure failure, logged on the server
// and reported without its details.
export function refusalResponse(error: unknown, fallback: string) {
  const message = refusalMessage(error);
  if (message !== undefined)
    return NextResponse.json({ error: message }, { status: 409 });
  console.error(error);
  return NextResponse.json({ error: fallback }, { status: 503 });
}

function refusalMessage(error: unknown) {
  if (!(error instanceof ConvexError)) return undefined;
  const data: unknown = error.data;
  if (typeof data === "string") return data;
  if (
    typeof data === "object" &&
    data &&
    "message" in data &&
    typeof data.message === "string"
  )
    return data.message;
  return undefined;
}
