// @vitest-environment node
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  home: "",
  publicKey: undefined as CryptoKey | undefined,
  /** Runs while a model catalog request is in flight, before it responds. */
  duringCatalog: undefined as (() => Promise<void>) | undefined,
}));
vi.mock("node:os", async (original) => ({
  ...(await original<typeof import("node:os")>()),
  homedir: () => state.home,
}));
vi.mock("jose", async (original) => ({
  ...(await original<typeof import("jose")>()),
  createRemoteJWKSet: () => () => state.publicKey,
}));

import {
  assertLocalChatGPTRequest,
  beginChatGPTSignIn,
  completeChatGPTSignIn,
  disconnectChatGPT,
  getChatGPTCallbackRedirect,
  getChatGPTCredentials,
  getChatGPTSelection,
  getChatGPTReviewSelection,
  getChatGPTStatus,
  setChatGPTSettings,
} from "./local-account";

const userId = "local-user";
const localRequest = () =>
  new Request("http://localhost:3000/api/providers/chatgpt", {
    method: "POST",
    headers: { Origin: "http://localhost:3000" },
  });
let privateKey: CryptoKey;
let scopes = "openid offline_access resource.invoke chatgpt.tokens.use.direct";
let claims: Record<string, unknown> = {};
let activeNonce = "";
const fetchMock = vi.fn();

async function authorize() {
  const url = new URL(await beginChatGPTSignIn(userId, localRequest()));
  activeNonce = url.searchParams.get("nonce")!;
  const callback = new URL(url.searchParams.get("redirect_uri")!);
  callback.search = new URLSearchParams({
    state: url.searchParams.get("state")!,
    code: "one-time-code",
    client_id: "oaiapp_local",
  }).toString();
  const destination = await getChatGPTCallbackRedirect(new Request(callback));
  expect(new URL(destination!).origin).toBe("http://localhost:3000");
  callback.hostname = "localhost";
  await completeChatGPTSignIn(new Request(callback), userId);
  return { url, callback };
}

beforeEach(async () => {
  state.home = await mkdtemp(join(tmpdir(), "meteroite-chatgpt-"));
  const keys = await generateKeyPair("RS256");
  privateKey = keys.privateKey;
  state.publicKey = keys.publicKey;
  scopes = "openid offline_access resource.invoke chatgpt.tokens.use.direct";
  claims = {};
  fetchMock.mockReset();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("VERCEL", "");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (input, options) => {
    const url = String(input);
    if (url.endsWith("/oauth/token")) {
      const body = new URLSearchParams(options.body);
      if (body.get("grant_type") === "refresh_token")
        return Response.json({
          access_token: "renewed-access",
          refresh_token: "rotated-refresh",
          token_type: "Bearer",
          expires_in: 3600,
        });
      const idToken = await new SignJWT({
        sub: "chatgpt-subject",
        nonce: activeNonce,
        email: "person@example.com",
        ...claims,
      })
        .setProtectedHeader({ alg: "RS256" })
        .setIssuer("https://auth.openai.com")
        .setAudience("oaiapp_local")
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(privateKey);
      return Response.json({
        access_token: "private-access",
        refresh_token: "private-refresh",
        id_token: idToken,
        token_type: "Bearer",
        expires_in: 3600,
        scope: scopes,
      });
    }
    if (url.endsWith("/models")) {
      const hook = state.duringCatalog;
      state.duringCatalog = undefined;
      await hook?.();
      return Response.json({
        models: [
          {
            slug: "account-model",
            display_name: "Account model",
            visibility: "list",
          },
          { slug: "hidden", display_name: "Hidden", visibility: "hide" },
        ],
      });
    }
    if (url.endsWith("openid-configuration"))
      return Response.json({
        revocation_endpoint: "https://auth.openai.com/revoke",
      });
    if (url.endsWith("/revoke")) return new Response(null, { status: 200 });
    throw new Error(`Unexpected URL: ${url}`);
  });
});
afterEach(async () => {
  state.duringCatalog = undefined;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(state.home, { recursive: true, force: true });
});

describe("local ChatGPT connection", () => {
  it("uses the browser-facing Host when Next normalizes a loopback request URL", async () => {
    const request = new Request("http://localhost:3000/api/providers/chatgpt", {
      method: "POST",
      headers: { Host: "127.0.0.1:3000", Origin: "http://127.0.0.1:3000" },
    });
    const url = new URL(await beginChatGPTSignIn(userId, request));
    activeNonce = url.searchParams.get("nonce")!;
    const callback = new URL("http://localhost:3000/auth/callback");
    callback.search = new URLSearchParams({
      state: url.searchParams.get("state")!,
      code: "one-time-code",
      client_id: "oaiapp_local",
    }).toString();
    const callbackRequest = new Request(callback, {
      headers: { Host: "127.0.0.1:3000" },
    });
    expect(await getChatGPTCallbackRedirect(callbackRequest)).toBeUndefined();
    await completeChatGPTSignIn(callbackRequest, userId);
    expect((await getChatGPTStatus(userId)).connected).toBe(true);
  });

  it("uses PKCE, validates identity, saves protected credentials, and returns only public state", async () => {
    const { url, callback } = await authorize();
    expect(url.searchParams.get("client_id")).toBe("dynamic_agent_client");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:3000/auth/callback",
    );
    const directory = join(state.home, ".config/meteroite/chatgpt");
    const files = await readdir(directory);
    const path = join(
      directory,
      files.find((file) => file.endsWith(".json"))!,
    );
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    const status = await getChatGPTStatus(userId);
    expect(status).toMatchObject({
      connected: true,
      enabled: true,
      email: "person@example.com",
      model: "account-model",
    });
    expect(status.models).toHaveLength(1);
    expect(JSON.stringify(status)).not.toContain("private-");
    const selection = await getChatGPTSelection(userId, localRequest());
    expect(Object.keys(selection!).sort()).toEqual([
      "connectionId",
      "model",
      "userId",
    ]);
    await expect(
      completeChatGPTSignIn(new Request(callback), userId),
    ).rejects.toThrow("no longer valid");
    await expect(
      getChatGPTCredentials({
        userId: "another-user",
        connectionId: status.connectionId!,
      }),
    ).rejects.toThrow("disconnected");
  });

  it("binds account linking to the initiating Meteroite user and host", async () => {
    const url = new URL(await beginChatGPTSignIn(userId, localRequest()));
    const callback = new URL(url.searchParams.get("redirect_uri")!);
    callback.search = new URLSearchParams({
      state: url.searchParams.get("state")!,
      code: "code",
      client_id: "oaiapp_local",
    }).toString();
    await expect(
      completeChatGPTSignIn(new Request(callback), userId),
    ).rejects.toThrow("account that started");
    const destination = await getChatGPTCallbackRedirect(new Request(callback));
    await expect(
      completeChatGPTSignIn(new Request(destination!), "another-user"),
    ).rejects.toThrow("account that started");
    expect(fetchMock).not.toHaveBeenCalled();
    activeNonce = url.searchParams.get("nonce")!;
    await completeChatGPTSignIn(new Request(destination!), userId);
    expect((await getChatGPTStatus(userId)).connected).toBe(true);
  });

  it("selects review models independently of the coding preference and rejects unavailable models", async () => {
    await authorize();
    await setChatGPTSettings(userId, { enabled: false });
    expect(
      await getChatGPTReviewSelection(userId, localRequest(), "account-model"),
    ).toMatchObject({ userId, model: "account-model" });
    await expect(
      getChatGPTReviewSelection(userId, localRequest(), "hidden"),
    ).rejects.toThrow("available");
  });

  it("does not commit a model validated against a connection replaced during validation", async () => {
    await authorize();
    const previous = await getChatGPTStatus(userId);
    await setChatGPTSettings(userId, { enabled: true });
    state.duringCatalog = async () => {
      await authorize();
    };
    await expect(
      setChatGPTSettings(userId, { model: "account-model" }),
    ).rejects.toThrow("changed while choosing a model");
    const directory = join(state.home, ".config/meteroite/chatgpt");
    const saved = JSON.parse(
      await readFile(
        join(
          directory,
          (await readdir(directory)).find((file) => file.endsWith(".json"))!,
        ),
        "utf8",
      ),
    );
    expect(saved.connectionId).not.toBe(previous.connectionId);
    expect(saved.model).toBeUndefined();
  });

  describe("model catalog cache", () => {
    const catalogRequests = () =>
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/models"))
        .length;

    it("serves repeated selections without another catalog request", async () => {
      await authorize();
      await getChatGPTSelection(userId, localRequest());
      await getChatGPTSelection(userId, localRequest());
      await getChatGPTStatus(userId);
      expect(catalogRequests()).toBe(1);
    });

    it("expires after its lifetime", async () => {
      await authorize();
      await getChatGPTStatus(userId);
      const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
      try {
        await getChatGPTStatus(userId);
      } finally {
        now.mockRestore();
      }
      expect(catalogRequests()).toBe(2);
    });

    it("is dropped on disconnect and reconnect", async () => {
      await authorize();
      await getChatGPTStatus(userId);
      await disconnectChatGPT(userId);
      await expect(
        getChatGPTReviewSelection(userId, localRequest(), "account-model"),
      ).rejects.toThrow("Connect ChatGPT");
      await authorize();
      await getChatGPTStatus(userId);
      expect(catalogRequests()).toBe(2);
    });

    it("does not cache failures, so retrying fetches fresh models", async () => {
      await authorize();
      state.duringCatalog = async () => {
        throw new Error("offline");
      };
      expect((await getChatGPTStatus(userId)).error).toBeDefined();
      const retried = await getChatGPTStatus(userId);
      expect(retried.error).toBeUndefined();
      expect(retried.models).toHaveLength(1);
      expect(catalogRequests()).toBe(2);
    });
  });

  it("rejects a signed ID token with a different nonce", async () => {
    claims = { nonce: "not-this-attempt" };
    await expect(authorize()).rejects.toThrow("identity did not match");
    expect((await getChatGPTStatus(userId)).connected).toBe(false);
  });

  it("rejects identity-only consent without subscription access", async () => {
    scopes = "openid profile email";
    await expect(authorize()).rejects.toThrow("plan access was not granted");
    expect((await getChatGPTStatus(userId)).connected).toBe(false);
  });

  it("serializes refreshes and saves the rotating token without losing the grant", async () => {
    await authorize();
    const directory = join(state.home, ".config/meteroite/chatgpt");
    const path = join(
      directory,
      (await readdir(directory)).find((file) => file.endsWith(".json"))!,
    );
    const account = JSON.parse(await readFile(path, "utf8"));
    await writeFile(path, JSON.stringify({ ...account, expiresAt: 0 }));
    const selection = { userId, connectionId: account.connectionId };
    expect(
      await Promise.all([
        getChatGPTCredentials(selection),
        getChatGPTCredentials(selection),
      ]),
    ).toEqual(["renewed-access", "renewed-access"]);
    const refreshes = fetchMock.mock.calls.filter(
      ([, options]) =>
        new URLSearchParams(options?.body).get("grant_type") ===
        "refresh_token",
    );
    expect(refreshes).toHaveLength(1);
    const saved = JSON.parse(await readFile(path, "utf8"));
    expect(saved.refreshToken).toBe("rotated-refresh");
    expect(saved.scopes).toContain("chatgpt.tokens.use.direct");
  });

  it("can switch to OpenRouter, reject unavailable models, and revoke/clear tokens", async () => {
    const { url } = await authorize();
    const status = await getChatGPTStatus(userId);
    await setChatGPTSettings(userId, { enabled: false });
    expect(await getChatGPTSelection(userId, localRequest())).toBeUndefined();
    await expect(
      setChatGPTSettings(userId, { model: "hidden" }),
    ).rejects.toThrow("available");
    expect(await disconnectChatGPT(userId)).toBe(true);
    expect((await getChatGPTStatus(userId)).connected).toBe(false);
    await expect(
      getChatGPTCredentials({ userId, connectionId: status.connectionId! }),
    ).rejects.toThrow("disconnected");
    const returning = new URL(await beginChatGPTSignIn(userId, localRequest()));
    expect(returning.searchParams.get("client_id")).toBe("oaiapp_local");
    expect(returning.searchParams.get("ext_agent_host_id")).toBe(
      url.searchParams.get("ext_agent_host_id"),
    );
    expect(returning.searchParams.has("id_token_hint")).toBe(false);
  });

  it("blocks hosted access and cross-origin mutations", () => {
    expect(() =>
      assertLocalChatGPTRequest(
        new Request("http://localhost:3000/api/providers/chatgpt", {
          headers: {
            Host: "attacker.example",
            Origin: "http://attacker.example",
          },
        }),
        true,
      ),
    ).toThrow("local");
    expect(() =>
      assertLocalChatGPTRequest(
        new Request("http://localhost:3000/api/providers/chatgpt", {
          headers: { Host: "127.0.0.1:3000", Origin: "http://localhost:3000" },
        }),
        true,
      ),
    ).toThrow("settings");
    expect(() =>
      assertLocalChatGPTRequest(
        new Request("https://meteroite.example/api/providers/chatgpt"),
      ),
    ).toThrow("local");
    expect(() =>
      assertLocalChatGPTRequest(
        new Request("http://localhost:3000/api/providers/chatgpt", {
          headers: { Origin: "https://attacker.example" },
        }),
        true,
      ),
    ).toThrow("settings");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => assertLocalChatGPTRequest(localRequest())).toThrow("local");
  });
});
