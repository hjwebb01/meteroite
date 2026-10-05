import { z } from "zod";
import { NextResponse } from "next/server";
import { fetchMutation } from "convex/nextjs";

import { inngest } from "@/inngest/client";
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

  const jobId = await fetchMutation(
    api.projects.cancelExport,
    { projectId: projectId as Id<"projects"> },
    { token: convexAuth.token },
  );

  if (!jobId) {
    return NextResponse.json({ success: true, projectId });
  }

  const event = await inngest.send({
    name: "github/export.cancel",
    data: {
      jobId,
    },
  });

  return NextResponse.json({
    success: true,
    projectId,
    cancelled: true,
    eventId: event.ids[0]
  });
};
