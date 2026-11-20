import { clerkClient } from "@clerk/nextjs/server";
import { NonRetriableError } from "inngest";
import { Octokit } from "octokit";

export const getGithubToken = async (userId: string) => {
  const client = await clerkClient();
  const tokens = await client.users.getUserOauthAccessToken(userId, "github");
  return tokens.data[0]?.token ?? null;
};

export const createUserOctokit = async (userId: string) => {
  const token = await getGithubToken(userId);
  if (!token) {
    throw new NonRetriableError("GitHub account is not connected");
  }
  return new Octokit({ auth: token });
};
