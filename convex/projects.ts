import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const create = mutation({
    args: {
        name: v.string(),
    },
    handler: async (ctx, args) => {
        const userId = await ctx.auth.getUserIdentity();
        if (!userId) {
            throw new Error("Unauthorized");
        }
        return await ctx.db.insert("projects", {
            name: args.name,
            ownerId: userId?.subject,
        });
    },
});

export const get = query({
    args: {},
    handler: async (ctx) => {
        const userId = await ctx.auth.getUserIdentity();
        if (!userId) {
            return [];
        }
        return await ctx.db
            .query("projects")
            .withIndex("by_owner", (q) => q.eq("ownerId", userId.subject))
            .collect();
    }
})