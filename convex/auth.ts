import { Id } from "./_generated/dataModel";
import { MutationCtx, QueryCtx } from "./_generated/server";

export const verifyAuth = async (ctx: MutationCtx | QueryCtx) => {
  const userId = await ctx.auth.getUserIdentity();
  if (!userId) {
    throw new Error("Unauthorized");
  }
  return userId;
};

export const getOwnedProject = async (
  ctx: MutationCtx | QueryCtx,
  projectId: Id<"projects">,
) => {
  const userId = await verifyAuth(ctx);
  const project = await ctx.db.get("projects", projectId);
  if (!project) {
    throw new Error("Project not found");
  }
  if (project.ownerId !== userId.subject) {
    throw new Error("Unauthorized to access this project");
  }
  return project;
};
