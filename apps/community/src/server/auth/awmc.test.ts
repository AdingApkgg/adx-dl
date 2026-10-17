import { beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { createApp } from "../app";
import { account, user } from "../db/schema";
import { testAppDeps } from "../testing/app-deps";
import { ageSessions, createTestAuth, currentUserId, googleProfile, signInWithGoogle } from "../testing/auth";
import { Browser } from "../testing/auth-browser";
import { TEST_PUBLIC_ORIGIN } from "../testing/constants";
import { resetTestDatabase, testDbHandle } from "../testing/test-db";

beforeAll(resetTestDatabase, 30000);
const client = { clientId: "test-awmc-client", clientSecret: "test-awmc-secret" };

async function login(browser: Browser, id: number, link = false, profile: Record<string, unknown> = {}, failure?: "network" | "json", tokenFailure?: "network" | "json" | "http" | "invalid") {
  const start = await browser.request("POST", link ? "/api/auth/link-social" : "/api/auth/sign-in/social", {
    body: { provider: "awmc", callbackURL: "/", newUserCallbackURL: "/onboarding", errorCallbackURL: "/login" },
  });
  expect(start.status).toBe(200);
  const target = new URL(start.json.url);
  expect(target.origin + target.pathname).toBe("https://bbs.wmc.pub/audapi/oauth2/authorize");
  expect(target.searchParams.get("scope")).toBe("user:read");
  expect(target.searchParams.get("redirect_uri")).toBe(`${TEST_PUBLIC_ORIGIN}/api/auth/callback/awmc`);
  expect(target.searchParams.has("client_secret")).toBe(false);
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://bbs.wmc.pub/api/audapi-oauth2/token") {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("client_id")).toBe(client.clientId);
      expect(body.get("client_secret")).toBe(client.clientSecret);
      const verifier = body.get("code_verifier");
      expect(verifier).toBeTruthy();
      expect(createHash("sha256").update(verifier!).digest("base64url")).toBe(target.searchParams.get("code_challenge")!);
      if (tokenFailure === "network") throw new TypeError(`private-token-detail:${client.clientSecret}`);
      if (tokenFailure === "json") return new Response(`{private-token-detail:${client.clientSecret}`, { headers: { "content-type": "application/json" } });
      if (tokenFailure === "http") return new Response(`private-token-detail:${client.clientSecret}`, { status: 502 });
      if (tokenFailure === "invalid") return Response.json({ access_token: 42, private: client.clientSecret });
      return Response.json({ access_token: "private-fixture-access", token_type: "bearer", expires_in: 3600 });
    }
    if (url === "https://bbs.wmc.pub/api/me") {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer private-fixture-access");
      if (failure === "network") throw new TypeError("private upstream failure");
      if (failure === "json") return new Response("broken-json", { headers: { "content-type": "application/json" } });
      return Response.json({ me: { user_id: id, username: "AWMC 用户", email: "same@example.test", ...profile } });
    }
    return original(input, init);
  }) as typeof fetch;
  try {
    return await browser.request("GET", `/api/auth/callback/awmc?code=fixture-code&state=${encodeURIComponent(target.searchParams.get("state")!)}`, { origin: null });
  } finally { globalThis.fetch = original; }
}

function app() { return createApp(testAppDeps({ auth: createTestAuth({ awmc: client }).auth }).deps); }

test("AWMC stable subject signs in repeatedly without persisting provider tokens or exposing real email", async () => {
  const browser = new Browser(app());
  const id = Math.floor(Math.random() * 100000000) + 1;
  expect((await login(browser, id)).status).toBe(302);
  const uid = await currentUserId(browser);
  const firstProfile = await browser.request("GET", "/api/v1/me");
  expect(firstProfile.json.publicId).toMatch(/^[1-9]\d*$/);
  expect((await login(browser, id)).status).toBe(302);
  expect(await currentUserId(browser)).toBe(uid);
  expect((await browser.request("GET", "/api/v1/me")).json.publicId).toBe(firstProfile.json.publicId);
  const rows = await testDbHandle().db.select().from(account).where(eq(account.userId, uid));
  expect(rows).toHaveLength(1);
  expect(rows[0]!.accountId).toBe(String(id));
  expect(rows[0]!.providerId).toBe("awmc");
  for (const field of ["accessToken", "refreshToken", "idToken"] as const) expect(rows[0]![field]).toBeNull();
  const [local] = await testDbHandle().db.select().from(user).where(eq(user.id, uid));
  expect(local!.email.endsWith("@placeholder.invalid")).toBe(true);
  expect(local!.name).toBe("AWMC 用户");
});

test("explicit AWMC binding retains current user; last login method cannot be removed", async () => {
  const browser = new Browser(app());
  await signInWithGoogle(browser, googleProfile());
  const uid = await currentUserId(browser);
  const publicId = (await browser.request("GET", "/api/v1/me")).json.publicId;
  await login(browser, Math.floor(Math.random() * 100000000) + 1, true);
  expect(await currentUserId(browser)).toBe(uid);
  expect((await browser.request("GET", "/api/v1/me")).json.publicId).toBe(publicId);
  const logins = await browser.request("GET", "/api/v1/me/logins");
  expect(logins.json.accounts.map((a: { provider: string }) => a.provider).sort()).toEqual(["awmc", "google"]);
  const google = logins.json.accounts.find((a: { provider: string }) => a.provider === "google");
  const awmc = logins.json.accounts.find((a: { provider: string }) => a.provider === "awmc");
  expect((await browser.request("POST", "/api/auth/unlink-account", { body: { accountId: google.id } })).status).toBe(200);
  expect((await browser.request("POST", "/api/auth/unlink-account", { body: { accountId: awmc.id } })).json.code).toBe("LAST_LOGIN_METHOD");
});

test("AWMC callback rejects invalid immutable identity without a session", async () => {
  const browser = new Browser(app());
  const result = await login(browser, 0);
  expect(result.headers.get("location")).toContain("error=");
  expect((await browser.request("GET", "/api/auth/get-session")).json).toBeNull();
});

for (const failure of ["network", "json"] as const) {
  test(`AWMC ${failure} user-info failure redirects safely without creating a session`, async () => {
    const browser = new Browser(app());
    const response = await login(browser, 1, false, {}, failure);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("/login?error=unable_to_get_user_info");
    expect((await browser.request("GET", "/api/auth/get-session")).json).toBeNull();
  });
}

test("equal provider emails never implicitly merge separate AWMC identities", async () => {
  const application = app(), first = new Browser(application), second = new Browser(application);
  const id = Math.floor(Math.random() * 100000000) + 1;
  await login(first, id);
  await login(second, id + 1);
  expect(await currentUserId(first)).not.toBe(await currentUserId(second));
});

test("AWMC identity already owned by another user cannot be rebound", async () => {
  const application = app(), owner = new Browser(application), other = new Browser(application);
  const id = Math.floor(Math.random() * 100000000) + 1;
  await login(owner, id);
  await signInWithGoogle(other, googleProfile());
  const uid = await currentUserId(other);
  const result = await login(other, id, true);
  expect(result.headers.get("location")).toContain("account_already_linked_to_different_user");
  expect(await currentUserId(other)).toBe(uid);
});

for (const failure of ["network", "json", "http", "invalid"] as const) {
  test(`AWMC ${failure} token exchange failure never logs provider details or creates a session`, async () => {
    const fixture = createTestAuth({ awmc: client });
    const browser = new Browser(createApp(testAppDeps({ auth: fixture.auth }).deps));
    const response = await login(browser, 1, false, {}, undefined, failure);
    expect(response.status).toBe(302);
    const location = response.headers.get("location") ?? "";
    expect(location).toContain("/login?error=");
    expect(location).not.toContain("private-token-detail");
    expect(location).not.toContain(client.clientSecret);
    expect((await browser.request("GET", "/api/auth/get-session")).json).toBeNull();
    const logs = JSON.stringify(fixture.logs());
    expect(logs).not.toContain(client.clientSecret);
    expect(logs).not.toContain("private-token-detail");
  });
}

test("AWMC identity does not depend on a readable or valid provider email", async () => {
  const browser = new Browser(app());
  const id = Math.floor(Math.random() * 100000000) + 1;
  expect((await login(browser, id, false, { email: "not-an-email" })).status).toBe(302);
  const uid = await currentUserId(browser);
  expect((await login(browser, id, false, { email: null })).status).toBe(302);
  expect(await currentUserId(browser)).toBe(uid);
});

for (const state of ["stale", "pending_deletion"] as const) {
  test(`AWMC binding rejects a ${state} account before starting authorization`, async () => {
    const browser = new Browser(app());
    await signInWithGoogle(browser, googleProfile());
    const uid = await currentUserId(browser);
    if (state === "stale") await ageSessions(uid, 11);
    else await testDbHandle().db.update(user).set({ status: "pending_deletion" }).where(eq(user.id, uid));
    const response = await browser.request("POST", "/api/auth/link-social", {
      body: { provider: "awmc", callbackURL: "/settings/account" },
    });
    expect(response.status).toBe(403);
    expect(response.json.code).toBe(state === "stale" ? "REAUTH_REQUIRED" : "ACCOUNT_PENDING_DELETION");
    const rows = await testDbHandle().db.select().from(account).where(eq(account.userId, uid));
    expect(rows.map((row) => row.providerId)).toEqual(["google"]);
  });
}
