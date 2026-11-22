import { auth } from "@clerk/nextjs/server";

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
