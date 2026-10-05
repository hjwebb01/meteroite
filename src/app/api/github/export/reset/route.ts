import { z } from "zod";
import { NextResponse } from "next/server";
import { fetchMutation } from "convex/nextjs";

import { getConvexAuth } from "@/lib/convex-auth";

import { api } from "../../../../../../convex/_generated/api";
import { Id } from "../../../../../../convex/_generated/dataModel";

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

  await fetchMutation(
    api.projects.resetExport,
    { projectId: projectId as Id<"projects"> },
    { token: convexAuth.token },
  );

  return NextResponse.json({
    success: true,
    projectId,
  });
};
