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

export function getConvexAdminClient(): ConvexAdminClient {
  const deployKey = process.env.CONVEX_DEPLOY_KEY;
  if (!deployKey) {
    throw new Error("CONVEX_DEPLOY_KEY is not configured");
  }
  const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  (client as AdminConvexHttpClient).setAdminAuth(deployKey);
  return client as unknown as ConvexAdminClient;
}
