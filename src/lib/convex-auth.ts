import { auth } from "@clerk/nextjs/server";

/**
 * Clerk identity plus a Convex JWT for calling Convex as the signed-in user
 * via `fetchQuery` / `fetchMutation(..., { token })`. Convex then enforces
 * project ownership itself. Returns null when the request is unauthenticated.
 */
export const getConvexAuth = async () => {
  const { userId, getToken } = await auth();
  if (!userId) {
    return null;
  }
  const token = await getToken({ template: "convex" });
  if (!token) {
    return null;
  }
  return { userId, token };
};
