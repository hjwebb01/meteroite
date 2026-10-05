import { clerkClient } from "@clerk/nextjs/server";
import { NonRetriableError } from "inngest";
import { Octokit } from "octokit";

export const getGithubToken = async (userId: string) => {
  const client = await clerkClient();
  const tokens = await client.users.getUserOauthAccessToken(userId, "github");
  return tokens.data[0]?.token ?? null;
};

/**
 * Builds an Octokit for the user inside an Inngest step. Call it in each step
 * that needs GitHub and never return the token: event payloads and step
 * results are persisted by Inngest.
 */
export const createUserOctokit = async (userId: string) => {
  const token = await getGithubToken(userId);
  if (!token) {
    throw new NonRetriableError("GitHub account is not connected");
  }
  return new Octokit({ auth: token });
};
