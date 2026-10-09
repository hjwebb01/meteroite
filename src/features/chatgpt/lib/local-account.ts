import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { lock } from "proper-lockfile";
import { z } from "zod";
import {
  UNAVAILABLE_CHATGPT_STATUS,
  type ChatGPTModel,
  type ChatGPTSelection,
  type ChatGPTStatus,
} from "./types";

const ISSUER = "https://auth.openai.com";
const RESOURCE = "https://api.openai.com/v1";
const TOKEN_ENDPOINT = `${ISSUER}/api/accounts/oauth/token`;
const jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
const root = () => join(homedir(), ".config", "meteroite", "chatgpt");
const key = (value: string) => createHash("sha256").update(value).digest("hex");
const accountPath = (userId: string) => join(root(), `${key(userId)}.json`);
const pendingPath = (state: string) =>
  join(root(), `pending-${key(state)}.json`);

const accountSchema = z.object({
  clientId: z.string(),
  subject: z.string(),
  email: z.string().optional(),
  connectionId: z.string(),
  enabled: z.boolean(),
  model: z.string().optional(),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  idToken: z.string().optional(),
  expiresAt: z.number().optional(),
  scopes: z.array(z.string()),
});
type Account = z.infer<typeof accountSchema>;
const pendingSchema = z.object({
  userId: z.string(),
  state: z.string(),
  nonce: z.string(),
  verifier: z.string(),
  redirectUri: z.string(),
  returnOrigin: z.string(),
  expiresAt: z.number(),
  clientId: z.string().optional(),
  subject: z.string().optional(),
});
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  id_token: z.string().min(1).optional(),
  token_type: z.literal("Bearer"),
  expires_in: z.number().positive(),
  scope: z.string().optional(),
});

export function isLocalChatGPTRuntime() {
  return !process.env.VERCEL && process.env.NODE_ENV !== "production";
}

function requestUrl(request: Request) {
  const url = new URL(request.url);
  // Next's dev server can normalize 127.0.0.1 to localhost in request.url.
  const host = request.headers.get("host");
  if (host) url.host = host;
  return url;
}

export function assertLocalChatGPTRequest(request: Request, mutation = false) {
  const url = requestUrl(request);
  if (
    !isLocalChatGPTRuntime() ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  ) {
    throw new Error(
      "ChatGPT subscription access is available in local development only.",
    );
  }
  if (mutation && request.headers.get("origin") !== url.origin) {
    throw new Error("Open provider settings in Meteroite to make this change.");
  }
}

async function readAccount(userId: string): Promise<Account | undefined> {
  try {
    return accountSchema.parse(
      JSON.parse(await readFile(accountPath(userId), "utf8")),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function save(path: string, value: unknown) {
  await mkdir(root(), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** A filesystem lock also serializes rotating refresh tokens across Next workers. */
async function locked<T>(
  userId: string,
  operation: () => Promise<T>,
): Promise<T> {
  await mkdir(root(), { recursive: true, mode: 0o700 });
  const release = await lock(root(), {
    lockfilePath: `${accountPath(userId)}.lock`,
    stale: 60_000,
    retries: { retries: 40, factor: 1, minTimeout: 250, maxTimeout: 250 },
  });
  try {
    return await operation();
  } finally {
    await release();
  }
}

async function exchange(parameters: Record<string, string>) {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...parameters, resource: RESOURCE }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(
      "ChatGPT authorization failed. Connect your account again.",
    );
  return tokenSchema.parse(await response.json());
}

function applyTokens(
  account: Account,
  tokens: z.infer<typeof tokenSchema>,
): Account {
  const scopes = tokens.scope?.split(/\s+/).filter(Boolean) ?? account.scopes;
  if (!scopes.includes("chatgpt.tokens.use.direct")) {
    throw new Error(
      "ChatGPT plan access was not granted. Enable plan usage when connecting.",
    );
  }
  return {
    ...account,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? account.refreshToken,
    idToken: tokens.id_token ?? account.idToken,
    expiresAt: Date.now() + tokens.expires_in * 1000,
    scopes,
  };
}

export async function beginChatGPTSignIn(userId: string, request: Request) {
  assertLocalChatGPTRequest(request, true);
  const account = await readAccount(userId);
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(64).toString("base64url");
  const callback = requestUrl(request);
  callback.hostname = "127.0.0.1";
  callback.protocol = "http:";
  callback.pathname = "/auth/callback";
  callback.search = "";
  const pending = {
    userId,
    state,
    verifier,
    nonce: randomBytes(32).toString("base64url"),
    redirectUri: callback.toString(),
    returnOrigin: requestUrl(request).origin,
    expiresAt: Date.now() + 10 * 60_000,
    clientId: account?.clientId,
    subject: account?.subject,
  };
  await save(pendingPath(state), pending);
  const url = new URL(`${ISSUER}/api/accounts/authorize`);
  const hostPath = join(root(), "host-id");
  try {
    await writeFile(hostPath, `urn:uuid:${randomUUID()}`, {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const hostId = await readFile(hostPath, "utf8");
  url.search = new URLSearchParams({
    client_id: account?.clientId ?? "dynamic_agent_client",
    ...(account ? {} : { agent_name_hint: "Meteroite" }),
    ext_agent_host_id: hostId,
    response_type: "code",
    redirect_uri: pending.redirectUri,
    scope:
      "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
    resource: RESOURCE,
    state,
    nonce: pending.nonce,
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    ...(account?.email ? { login_hint: account.email } : {}),
  }).toString();
  return url.toString();
}

async function readPending(request: Request) {
  assertLocalChatGPTRequest(request);
  const url = requestUrl(request);
  const state = url.searchParams.get("state");
  if (!state)
    throw new Error("Sign-in state is missing. Start again in Meteroite.");
  let pending: z.infer<typeof pendingSchema>;
  try {
    pending = pendingSchema.parse(
      JSON.parse(await readFile(pendingPath(state), "utf8")),
    );
  } catch {
    throw new Error(
      "This sign-in attempt is no longer valid. Start again in Meteroite.",
    );
  }
  if (pending.state !== state || pending.expiresAt < Date.now())
    throw new Error("Sign-in expired. Start again in Meteroite.");
  return { pending, url, state };
}

/** Return to the initiating host so its Clerk session can bind account linking. */
export async function getChatGPTCallbackRedirect(request: Request) {
  const { pending, url } = await readPending(request);
  if (
    `${url.origin}${url.pathname}` !== pending.redirectUri &&
    `${url.origin}${url.pathname}` !== `${pending.returnOrigin}/auth/callback`
  )
    throw new Error("Sign-in callback does not match.");
  if (url.origin === pending.returnOrigin) return undefined;
  const destination = new URL("/auth/callback", pending.returnOrigin);
  destination.search = url.search;
  return destination.toString();
}

export async function completeChatGPTSignIn(request: Request, userId: string) {
  const { pending, url, state } = await readPending(request);
  if (
    pending.userId !== userId ||
    url.origin !== pending.returnOrigin ||
    url.pathname !== "/auth/callback"
  )
    throw new Error(
      "Return to the Meteroite account that started this sign-in.",
    );
  try {
    // Rename atomically so a callback can only be consumed once across workers.
    const consumed = `${pendingPath(state)}.${randomUUID()}.used`;
    await rename(pendingPath(state), consumed);
    await rm(consumed);
  } catch {
    throw new Error(
      "This sign-in attempt is no longer valid. Start again in Meteroite.",
    );
  }
  if (url.searchParams.has("error"))
    throw new Error("ChatGPT connection was cancelled or denied.");
  const code = url.searchParams.get("code");
  const clientId = url.searchParams.get("client_id") ?? pending.clientId;
  if (
    !code ||
    !clientId ||
    clientId === "dynamic_agent_client" ||
    (pending.clientId && pending.clientId !== clientId)
  ) {
    throw new Error(
      "ChatGPT registration was incomplete. Start again in Meteroite.",
    );
  }
  const tokens = await exchange({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    code_verifier: pending.verifier,
    redirect_uri: pending.redirectUri,
  });
  if (!tokens.id_token)
    throw new Error("ChatGPT did not return an identity token.");
  const { payload } = await jwtVerify(tokens.id_token, jwks, {
    issuer: ISSUER,
    audience: clientId,
    requiredClaims: ["sub", "exp", "iat"],
    clockTolerance: 5,
  });
  if (
    payload.nonce !== pending.nonce ||
    !payload.sub ||
    (pending.subject && payload.sub !== pending.subject)
  ) {
    throw new Error(
      "ChatGPT account identity did not match this sign-in attempt.",
    );
  }
  const account = applyTokens(
    {
      clientId,
      subject: payload.sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
      connectionId: randomUUID(),
      enabled: true,
      scopes: [],
    },
    tokens,
  );
  if (!account.refreshToken)
    throw new Error("ChatGPT did not grant renewable access. Connect again.");
  await locked(pending.userId, () =>
    save(accountPath(pending.userId), account),
  );
  forgetModels(pending.userId);
}

export async function getChatGPTCredentials(
  selection: Pick<ChatGPTSelection, "userId" | "connectionId">,
) {
  if (!isLocalChatGPTRuntime())
    throw new Error(
      "ChatGPT subscription execution requires local development.",
    );
  return locked(selection.userId, async () => {
    let account = await readAccount(selection.userId);
    if (
      !account?.accessToken ||
      account.connectionId !== selection.connectionId
    )
      throw new Error(
        "ChatGPT is disconnected. Connect your account in provider settings.",
      );
    if (!account.expiresAt || account.expiresAt < Date.now() + 60_000) {
      if (!account.refreshToken)
        throw new Error("Connect your ChatGPT account again.");
      account = applyTokens(
        account,
        await exchange({
          grant_type: "refresh_token",
          client_id: account.clientId,
          refresh_token: account.refreshToken,
        }),
      );
      await save(accountPath(selection.userId), account);
    }
    return account.accessToken!;
  });
}

async function fetchModels(userId: string, account: Account) {
  const accessToken = await getChatGPTCredentials({
    userId,
    connectionId: account.connectionId,
  });
  const response = await fetch(`${RESOURCE}/models`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(
      "Could not load your ChatGPT models. Reconnect or try again.",
    );
  const catalog = z
    .object({
      models: z.array(
        z.object({
          slug: z.string().min(1),
          display_name: z.string(),
          visibility: z.string(),
        }),
      ),
    })
    .parse(await response.json());
  return catalog.models
    .filter((model) => model.visibility === "list")
    .map((model) => ({
      id: model.slug,
      name: model.display_name,
      provider: "openai" as const,
    }));
}

/**
 * Keyed on the connection so a disconnect or reconnect never reuses a catalog.
 * Failures are not stored, which keeps "Retry loading models" a fresh request.
 */
const MODEL_CACHE_MS = 60_000;
const modelCache = new Map<
  string,
  { connectionId: string; expiresAt: number; models: ChatGPTModel[] }
>();

function forgetModels(userId: string) {
  modelCache.delete(userId);
}

async function listModels(userId: string, account: Account) {
  const cached = modelCache.get(userId);
  if (
    cached?.connectionId === account.connectionId &&
    cached.expiresAt > Date.now()
  )
    return cached.models;
  const models = await fetchModels(userId, account);
  modelCache.set(userId, {
    connectionId: account.connectionId,
    expiresAt: Date.now() + MODEL_CACHE_MS,
    models,
  });
  return models;
}

export async function getChatGPTStatus(userId: string): Promise<ChatGPTStatus> {
  if (!isLocalChatGPTRuntime())
    return UNAVAILABLE_CHATGPT_STATUS;
  const account = await readAccount(userId);
  if (!account?.accessToken)
    return { ...UNAVAILABLE_CHATGPT_STATUS, available: true };
  try {
    const models = await listModels(userId, account);
    const model = models.some((m) => m.id === account.model)
      ? account.model
      : models[0]?.id;
    return {
      available: true,
      connected: true,
      enabled: account.enabled,
      email: account.email,
      connectionId: account.connectionId,
      model,
      models,
      ...(!models.length
        ? { error: "Your ChatGPT account returned no available models." }
        : {}),
    };
  } catch (error) {
    return {
      available: true,
      connected: true,
      enabled: account.enabled,
      email: account.email,
      connectionId: account.connectionId,
      model: account.model,
      models: [],
      error:
        error instanceof Error
          ? error.message
          : "Could not load ChatGPT account.",
    };
  }
}

/** Validates outside the lock because listModels acquires it for credentials. */
async function connectionIdForModel(userId: string, model: string) {
  const account = await readAccount(userId);
  if (
    !account?.accessToken ||
    !(await listModels(userId, account)).some((entry) => entry.id === model)
  )
    throw new Error("Choose a model available to your ChatGPT account.");
  return account.connectionId;
}

export async function setChatGPTSettings(
  userId: string,
  settings: { enabled?: boolean; model?: string },
) {
  const validatedConnectionId = settings.model
    ? await connectionIdForModel(userId, settings.model)
    : undefined;
  await locked(userId, async () => {
    const account = await readAccount(userId);
    if (!account?.accessToken) throw new Error("Connect ChatGPT first.");
    // A reconnect or disconnect during validation invalidates the catalog check.
    if (validatedConnectionId && account.connectionId !== validatedConnectionId)
      throw new Error(
        "ChatGPT changed while choosing a model. Choose the model again.",
      );
    await save(accountPath(userId), { ...account, ...settings });
  });
  forgetModels(userId);
}

export async function getChatGPTSelection(
  userId: string,
  request: Request,
): Promise<ChatGPTSelection | undefined> {
  if (!isLocalChatGPTRuntime()) return undefined;
  const account = await readAccount(userId);
  if (!account?.enabled) return undefined;
  assertLocalChatGPTRequest(request, true);
  if (!account.accessToken)
    throw new Error("Connect ChatGPT before sending a message.");
  const models = await listModels(userId, account);
  const model = models.find((m) => m.id === account.model)?.id ?? models[0]?.id;
  if (!model) throw new Error("Your ChatGPT account has no available models.");
  return { userId, connectionId: account.connectionId, model };
}

/** A review explicitly chooses its provider independently of the coding preference. */
export async function getChatGPTReviewSelection(
  userId: string,
  request: Request,
  model: string,
): Promise<ChatGPTSelection> {
  assertLocalChatGPTRequest(request, true);
  const account = await readAccount(userId);
  if (!account?.accessToken)
    throw new Error(
      "Connect ChatGPT in provider settings before reviewing with your subscription.",
    );
  if (!(await listModels(userId, account)).some((entry) => entry.id === model))
    throw new Error(
      "Choose a model available to your connected ChatGPT account.",
    );
  return { userId, connectionId: account.connectionId, model };
}

export async function disconnectChatGPT(userId: string) {
  return locked(userId, async () => {
    const account = await readAccount(userId);
    if (!account) return true;
    let revoked = !account.refreshToken;
    if (account.refreshToken) {
      try {
        const discovery = await fetch(
          `${ISSUER}/.well-known/openid-configuration`,
          { signal: AbortSignal.timeout(10_000) },
        );
        const { revocation_endpoint: endpoint } = z
          .object({ revocation_endpoint: z.string().url() })
          .parse(await discovery.json());
        if (new URL(endpoint).origin !== ISSUER)
          throw new Error("Invalid revocation endpoint");
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            token: account.refreshToken,
            token_type_hint: "refresh_token",
            client_id: account.clientId,
          }),
          signal: AbortSignal.timeout(10_000),
        });
        revoked = response.status === 200;
      } catch {
        revoked = false;
      }
    }
    // Retain registration identity and host ID for a later sign-in, clear all tokens.
    await save(accountPath(userId), {
      clientId: account.clientId,
      subject: account.subject,
      email: account.email,
      connectionId: randomUUID(),
      enabled: false,
      scopes: [],
    });
    forgetModels(userId);
    return revoked;
  });
}
