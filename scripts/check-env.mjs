// Reports which end-to-end flows can run locally, so verification stops at a
// named missing secret instead of a mocked test.
import { existsSync, readFileSync } from "node:fs";

const fileEnv = existsSync(".env.local")
  ? Object.fromEntries(
      readFileSync(".env.local", "utf8")
        .split("\n")
        .map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/))
        .filter(Boolean)
        .map(([, key, value]) => [key, value.trim()]),
    )
  : {};
const env = (name) => process.env[name] || fileEnv[name];
const has = (name) => Boolean(env(name));

// Mirrors convexDeployKeyProblem in src/lib/convex-client.ts: a preview key or
// another deployment's key is present but every admin call is unauthorized.
const deployKeyMismatch = () => {
  const url = env("NEXT_PUBLIC_CONVEX_URL");
  const key = env("CONVEX_DEPLOY_KEY");
  if (!url || !key) return null;
  const host = new URL(url).hostname;
  if (!host.endsWith(".convex.cloud")) return null;
  const deployment = host.split(".")[0];
  const keyDeployment = key.match(/^(?:dev|prod):([^|]+)\|/)?.[1];
  return keyDeployment === deployment
    ? null
    : `CONVEX_DEPLOY_KEY for ${deployment} (current key is "${key.split("|")[0]}")`;
};

// Live review acceptance runs as the AGENTS.md test user, whose GitHub
// connection only a person can grant (Clerk OAuth in the browser).
const TEST_USER = "meteroite-agent+clerk_test@example.com";
const testUserGithub = async () => {
  const clerk = (path) =>
    fetch(`https://api.clerk.com/v1${path}`, {
      headers: { Authorization: `Bearer ${env("CLERK_SECRET_KEY")}` },
      signal: AbortSignal.timeout(5_000),
    }).then((res) => res.json());
  try {
    const [user] = await clerk(
      `/users?email_address=${encodeURIComponent(TEST_USER)}`,
    );
    if (!user) return `Clerk user ${TEST_USER}`;
    const tokens = await clerk(
      `/users/${user.id}/oauth_access_tokens/oauth_github`,
    );
    return Array.isArray(tokens) && tokens.length > 0
      ? null
      : `GitHub connection for ${TEST_USER} (sign in as them and connect GitHub)`;
  } catch {
    return "Clerk API (api.clerk.com)";
  }
};

const reachable = async (url) => {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1_000) });
    return true;
  } catch {
    return false;
  }
};

const flows = [
  {
    name: "Sign in",
    env: [
      "NEXT_PUBLIC_CONVEX_URL",
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
      "CLERK_SECRET_KEY",
    ],
  },
  {
    name: "PR reviews",
    env: ["CONVEX_DEPLOY_KEY", "OPENROUTER_API_KEY"],
    services: [["Inngest dev server", "http://localhost:8288"]],
  },
  {
    name: "Review finding triage (Decisions API)",
    env: ["OPENAI_API_KEY"],
  },
  {
    name: "Live review of the fixture PR",
    env: ["CONVEX_DEPLOY_KEY", "OPENROUTER_API_KEY", "CLERK_SECRET_KEY"],
    services: [["Inngest dev server", "http://localhost:8288"]],
    check: testUserGithub,
  },
];

const devServerUp = await reachable("http://localhost:3000");
console.log(`next dev on :3000: ${devServerUp ? "up" : "down"}`);

let ready = true;
for (const flow of flows) {
  const missing = flow.env.filter((name) => !has(name));
  const mismatch =
    flow.env.includes("CONVEX_DEPLOY_KEY") && deployKeyMismatch();
  if (mismatch) missing.push(mismatch);
  for (const [label, url] of flow.services ?? []) {
    if (!(await reachable(url))) missing.push(`${label} (${url})`);
  }
  const problem =
    flow.check && missing.length === 0 ? await flow.check() : null;
  if (problem) missing.push(problem);
  ready &&= missing.length === 0;
  console.log(
    missing.length === 0
      ? `ok       ${flow.name}`
      : `blocked  ${flow.name}: missing ${missing.join(", ")}`,
  );
}
process.exit(ready ? 0 : 1);
