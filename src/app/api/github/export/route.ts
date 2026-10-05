import { z } from "zod";
import { NextResponse } from "next/server";
import { fetchMutation } from "convex/nextjs";

import { inngest } from "@/inngest/client";
import { getConvexAuth } from "@/lib/convex-auth";
import { getGithubToken } from "@/lib/github";

import { api } from "../../../../../convex/_generated/api";
import { Id } from "../../../../../convex/_generated/dataModel";

const requestSchema = z.object({
  projectId: z.string(),
  repoName: z.string().min(1).max(100),
  visibility: z.enum(["public", "private"]).default("private"),
  description: z.string().max(350).optional(),
});

export async function POST(request: Request) {
  const convexAuth = await getConvexAuth();

  if (!convexAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { projectId, repoName, visibility, description } = requestSchema.parse(body);

  // Checked here only for a friendly error; the worker fetches its own token.
  if (!(await getGithubToken(convexAuth.userId))) {
    return NextResponse.json(
      { error: "GitHub not connected. Please reconnect your GitHub account." },
      { status: 400 }
    );
  }

  const jobId = crypto.randomUUID();
  // Runs as the user, so Convex rejects projects they don't own.
  const started = await fetchMutation(
    api.projects.startExport,
    { projectId: projectId as Id<"projects">, jobId },
    { token: convexAuth.token },
  );
  if (!started) {
    return NextResponse.json(
      { error: "An export is already in progress" },
      { status: 409 }
    );
  }

  const event = await inngest.send({
    name: "github/export.repo",
    data: {
      projectId,
      jobId,
      userId: convexAuth.userId,
      repoName,
      visibility,
      description,
    },
  });

  return NextResponse.json({
    success: true,
    projectId,
    eventId: event.ids[0]
  });
};
