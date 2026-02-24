import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { verifyAuth } from "./auth";

export const create = mutation({
    args: {
        name: v.string(),
    },
    handler: async (ctx, args) => {
        const userId = await verifyAuth(ctx);
        const projectId = await ctx.db.insert("projects", {
            name: args.name,
            ownerId: userId.subject,
            updatedAt: Date.now(),
        });
        return projectId;
    },
});

export const getPartial = query({
    args: {
        limit: v.number(),
    },
    handler: async (ctx, args) => {
        const userId = await verifyAuth(ctx);

        return await ctx.db
            .query("projects")
            .withIndex("by_owner", (q) => q.eq("ownerId", userId.subject))
            .order("desc")
            .take(args.limit);
    },
});

export const get = query({
    args: {},
    handler: async (ctx) => {
        const userId = await verifyAuth(ctx);
        return ctx.db
            .query("projects")
            .withIndex("by_owner", (q) => q.eq("ownerId", userId.subject))
            .order("desc")
            .collect();
    },
});