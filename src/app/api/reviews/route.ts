import { NextResponse } from "next/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { z } from "zod";
import { getConvexAuth } from "@/lib/convex-auth";
import { convexDeployKeyProblem } from "@/lib/convex-client";
import { getGithubToken } from "@/lib/github";
import { inngest } from "@/inngest/client";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import {
  isCodingModelId,
  DEFAULT_CODING_MODEL_ID,
} from "../../../../convex/lib/coding_models";
import { parsePullRequestUrl } from "@/features/reviews/lib/review";

const requestSchema = z.object({
  url: z.string().max(500),
  instructions: z.string().max(4000).default(""),
  model: z
    .string()
    .refine(isCodingModelId, "Unsupported review model")
    .default(DEFAULT_CODING_MODEL_ID),
});

function missingConfiguration() {
  return [
    "OPENROUTER_API_KEY",
    "CONVEX_DEPLOY_KEY",
    ...(process.env.NODE_ENV === "production" ? ["INNGEST_EVENT_KEY"] : []),
  ].filter((key) => !process.env[key]);
}

export async function GET() {
  const identity = await getConvexAuth();
  if (!identity)
    return NextResponse.json(
      { error: "Sign in to review a pull request." },
      { status: 401 },
    );
  const missing = missingConfiguration();
  try {
    await fetchQuery(api.reviews.list, {}, { token: identity.token });
  } catch {
    return NextResponse.json({
      ready: false,
      historyAvailable: false,
      reason: missing.length
        ? "The review service needs configuration and the updated review backend before it can run."
        : "The review backend is unavailable. Deploy the updated Convex functions and check the authentication setup.",
      missing,
    });
  }
  if (missing.length)
    return NextResponse.json({
      ready: false,
      historyAvailable: true,
      reason: "The review service needs configuration before it can run.",
      missing,
    });
  const keyProblem = convexDeployKeyProblem();
  if (keyProblem)
    return NextResponse.json({
      ready: false,
      historyAvailable: true,
      reason: keyProblem,
      missing: [],
    });
  if (process.env.NODE_ENV !== "production") {
    try {
      const response = await fetch("http://localhost:8288/health", {
        signal: AbortSignal.timeout(1000),
      });
      if (!response.ok) throw new Error("Inngest is unavailable");
    } catch {
      return NextResponse.json({
        ready: false,
        historyAvailable: true,
        reason:
          "Start the Inngest development server to run background reviews.",
        missing: [],
      });
    }
  }
  return NextResponse.json({
    ready: true,
    historyAvailable: true,
    reason: "",
    missing: [],
    githubConnected: Boolean(await getGithubToken(identity.userId)),
  });
}

export async function POST(request: Request) {
  const identity = await getConvexAuth();
  if (!identity)
    return NextResponse.json(
      { error: "Sign in to review a pull request." },
      { status: 401 },
    );
  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      {
        error:
          "Enter a PR URL and review preferences of up to 4,000 characters.",
      },
      { status: 400 },
    );
  let target: ReturnType<typeof parsePullRequestUrl>;
  try {
    target = parsePullRequestUrl(parsed.data.url);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 },
    );
  }
  if (missingConfiguration().length || convexDeployKeyProblem())
    return NextResponse.json(
      { error: "The review service is not configured yet." },
      { status: 503 },
    );
  if (!(await getGithubToken(identity.userId)))
    return NextResponse.json(
      {
        error: "Connect GitHub through your account settings, then try again.",
      },
      { status: 409 },
    );
  let started: { id: string; created: boolean };
  try {
    started = await fetchMutation(
      api.reviews.start,
      {
        repoOwner: target.repoOwner,
        repoName: target.repoName,
        pullNumber: target.pullNumber,
        model: parsed.data.model,
        instructions: parsed.data.instructions.trim(),
      },
      { token: identity.token },
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "Could not save the review. Check the review backend and try again.",
      },
      { status: 503 },
    );
  }
  if (!started.created)
    return NextResponse.json({ reviewId: started.id }, { status: 202 });
  try {
    await inngest.send({
      name: "review/requested",
      data: { reviewId: started.id, ownerId: identity.userId },
    });
  } catch {
    await fetchMutation(
      api.reviews.failToQueue,
      {
        id: started.id as Id<"reviews">,
      },
      { token: identity.token },
    );
    return NextResponse.json(
      { error: "Could not start the background review. Try again." },
      { status: 503 },
    );
  }
  return NextResponse.json({ reviewId: started.id }, { status: 202 });
}
