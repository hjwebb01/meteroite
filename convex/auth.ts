import { MutationCtx, QueryCtx } from "./_generated/server";

export const verifyAuth = async (ctx: MutationCtx | QueryCtx) => {
    const userId = await ctx.auth.getUserIdentity();
    if (!userId) {
        throw new Error("Unauthorized");
    }
    return userId;
};