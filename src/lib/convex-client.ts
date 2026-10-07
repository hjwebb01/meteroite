import "server-only";
import { ConvexHttpClient } from "convex/browser";
import type {
  FunctionReference,
  FunctionReturnType,
  OptionalRestArgs,
} from "convex/server";

// HTTP calls support internal references at runtime with admin authentication;
// the SDK's public declarations only accept public references.
type ConvexAdminClient = {
  query<Query extends FunctionReference<"query", "internal">>(
    query: Query,
    ...args: OptionalRestArgs<Query>
  ): Promise<FunctionReturnType<Query>>;
  mutation<Mutation extends FunctionReference<"mutation", "internal">>(
    mutation: Mutation,
    ...args: OptionalRestArgs<Mutation>
  ): Promise<FunctionReturnType<Mutation>>;
};

// The installed SDK implements setAdminAuth but strips this @internal method
// from its published declarations. Keep that compatibility cast here.
type AdminConvexHttpClient = ConvexHttpClient & {
  setAdminAuth(token: string): void;
};

// Cloud deploy keys look like `dev:<deployment>|…` or `prod:<deployment>|…`.
// Preview keys, or keys for another deployment, are rejected by Convex with a
// bare "Not authorized", so name the mismatch before any call is made.
export function convexDeployKeyProblem(): string | null {
  const deployKey = process.env.CONVEX_DEPLOY_KEY;
  if (!deployKey) return "CONVEX_DEPLOY_KEY is not configured";
  const host = new URL(process.env.NEXT_PUBLIC_CONVEX_URL!).hostname;
  if (!host.endsWith(".convex.cloud")) return null;
  const deployment = host.split(".")[0];
  const keyDeployment = deployKey.match(/^(?:dev|prod):([^|]+)\|/)?.[1];
  if (keyDeployment === deployment) return null;
  return `CONVEX_DEPLOY_KEY is not a deploy key for ${deployment} (it starts with "${deployKey.split("|")[0]}"). Generate one in that deployment's Convex dashboard settings.`;
}

export function getConvexAdminClient(): ConvexAdminClient {
  const problem = convexDeployKeyProblem();
  if (problem) throw new Error(problem);
  const deployKey = process.env.CONVEX_DEPLOY_KEY!;
  const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  (client as AdminConvexHttpClient).setAdminAuth(deployKey);
  return client as unknown as ConvexAdminClient;
}
