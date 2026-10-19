/** Trusted SSH operator tool. Not an HTTP login endpoint or part of the app startup. */
import assert from "node:assert/strict";
import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { makeSignature } from "better-auth/crypto";
import { createAuth } from "../../src/server/auth/auth";
import { createDb } from "../../src/server/db/client";
import { user, userPublicIds, session } from "../../src/server/db/schema";
import { createLogger } from "../../src/shared/log";

async function main() {
const origin = "https://adxc.saop.cc";
const runId = process.env.SMOKE_RUN_ID ?? "";
const key = process.env.SMOKE_BRIDGE_KEY ?? "";
const publicId = process.env.SMOKE_USER_PUBLIC_ID ?? "1";
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
assert.match(runId, /^[a-f0-9]{32}$/);
assert.match(key, /^[a-f0-9]{64}$/);
assert.match(publicId, /^[1-9]\d*$/);
assert.equal(process.env.PUBLIC_ORIGIN, origin);
assert.ok(proxy, "PRODUCTION_OUTBOUND_PROXY_REQUIRED");
assert.ok((process.env.COMMUNITY_ADMIN_PUBLIC_IDS ?? "").split(",").map(x => x.trim()).includes(publicId), "EXISTING_ADMIN_REQUIRED");
const { db, pool } = createDb(process.env.DATABASE_URL!, { max: 2 });
const log = createLogger(() => {}); // Raw library errors never enter a secret-bearing log.
const disabled = () => { throw new Error("INTERACTIVE_AUTH_NOT_AVAILABLE_IN_OPERATOR_TOOL"); };
const auth = createAuth({
  db, log, publicOrigin: origin, secret: process.env.BETTER_AUTH_SECRET!,
  google: { clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! },
  rateLimitStore: { hit: disabled }, rateLimitEnabled: false, verifyTurnstile: disabled,
  qq: { codes: { allowSend: disabled, save: disabled, claimAttempt: disabled, consume: disabled }, sender: { sendCode: disabled, lookupNickname: disabled }, hasher: { qqKey: disabled, codeHash: disabled } },
});
const [identity] = await db.select({ id: user.id, status: user.status }).from(userPublicIds).innerJoin(user, eq(user.id, userPublicIds.userId)).where(eq(userPublicIds.publicId, BigInt(publicId)));
assert.ok(identity && identity.status === "active", "ACTIVE_EXISTING_ADMIN_REQUIRED");
const ctx = await auth.$context;
if (process.argv.includes("--cleanup-only")) {
  const own = await db.select({ token: session.token }).from(session).where(eq(session.userAgent, `ADXC SSH readonly smoke ${runId}`));
  for (const item of own) await ctx.internalAdapter.deleteSession(item.token);
  assert.equal((await db.select({ id: session.id }).from(session).where(eq(session.userAgent, `ADXC SSH readonly smoke ${runId}`))).length, 0);
  console.log(JSON.stringify({ event: "run_sessions_revoked", runId, verified: true, count: own.length }));
  await pool.end(); return;
}
const originalIds = (await db.select({ id: session.id }).from(session).where(eq(session.userId, identity.id))).map(x => x.id);
const expiresAt = new Date(Date.now() + 10 * 60_000);
const issued = await ctx.internalAdapter.createSession(identity.id, false, { expiresAt, userAgent: `ADXC SSH readonly smoke ${runId}`, ipAddress: "127.0.0.1" }, true);
assert.ok(issued && issued.expiresAt.getTime() <= expiresAt.getTime(), "BOUNDED_SESSION_REQUIRED");
const cookie = `${ctx.authCookies.sessionToken.name}=${encodeURIComponent(`${issued.token}.${await makeSignature(issued.token, process.env.BETTER_AUTH_SECRET!)}`)}`;
const localSession = await auth.api.getSession({ headers: new Headers({ cookie }) });
console.log(JSON.stringify({ event: "local_auth_verified", runId, valid: localSession?.user.id === identity.id }));
let revoked = false, rejectedWrites = 0, reads = 0, closing: Promise<void> | undefined;
const event = (name: string, fields = {}) => console.log(JSON.stringify({ event: name, runId, ...fields }));
async function revoke() {
  if (revoked) return;
  await ctx.internalAdapter.deleteSession(issued.token);
  assert.equal(await ctx.internalAdapter.findSession(issued.token), null, "SESSION_REVOCATION_NOT_CONFIRMED");
  const retained = (await db.select({ id: session.id }).from(session).where(eq(session.userId, identity.id))).map(x => x.id);
  assert.ok(originalIds.every(id => retained.includes(id)), "PREEXISTING_SESSION_CHANGED");
  revoked = true;
  event("session_revoked", { verified: true, originalSessionsPreserved: true, rejectedWrites, reads });
}
const matches = (path: string) => {
  if (/^\/(?:en\/|ja\/)?(?:u\/[1-9]\d*|forum(?:\/new|\/[1-9]\d*)?|charts(?:\/[1-9]\d*)?|lists(?:\/[1-9]\d*)?|downloads|notices|help|dash(?:\/(?:users|charts|status|reports|discussions|featured|notices|lists))?|me\/(?:notifications|following|feed|library|lists\/[a-f0-9-]{36}))(?:\.data)?$/.test(path)) return true;
  if (/^\/(?:en\/|ja\/)?me\/(?:workbench|imports|charts(?:\/[a-f0-9-]{36}(?:\/(?:review|compare))?)?)(?:\.data)?$/.test(path)) return true;
  if (/^\/api\/v1\/me\/charts(?:\/(?:workbench|bindings\/[a-f0-9-]{36}|[a-f0-9-]{36}(?:\/versions\/[a-f0-9-]{36}\/(?:fingerprint|assets\/(?:maidata|audio|cover)))?))?$/.test(path)) return true;
  if (/^\/assets\/[A-Za-z0-9_.-]+$/.test(path)) return true;
  if (path === "/api/v1/me") return true;
  if (/^\/api\/v1\/(?:me\/lists(?:\/reports|\/[a-f0-9-]{36})?|lists(?:\/[1-9]\d*)?)$/.test(path)) return true;
  if (/^\/api\/v1\/me\/following(?:\/feed|\/authors\/[1-9]\d*)?$/.test(path)) return true;
  return /^\/api\/v1\/(?:dash|discussions|site|charts|users)\//.test(path);
};
function authorized(request: Request) {
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${key}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
const server = Bun.serve({ hostname: "0.0.0.0", port: 41910, idleTimeout: 30, async fetch(request) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
  const url = new URL(request.url);
  if (url.pathname === "/_smoke/health" && request.method === "GET") return Response.json({ active: !revoked, publicId, expiresAt, rejectedWrites, reads, runId });
  if (url.pathname === "/_smoke/revoke" && request.method === "POST") { await revoke(); return Response.json({ revoked }); }
  if (revoked || Date.now() >= expiresAt.getTime()) return new Response("Session unavailable", { status: 401 });
  if (!["GET", "HEAD"].includes(request.method)) { rejectedWrites++; return new Response("Readonly smoke bridge", { status: 405 }); }
  // Never expose auth/session-management responses, and never accept arbitrary URLs.
  if (!matches(url.pathname)) return new Response("Outside smoke read scope", { status: 403 });
  const headers = new Headers({ cookie, host: "adxc.saop.cc" });
  for (const name of ["accept", "accept-language", "range", "user-agent"]) {
    const value = request.headers.get(name); if (value) headers.set(name, value);
  }
  headers.set("cache-control", "no-cache");
  try {
    const upstream = await fetch(origin + url.pathname + url.search, { method: request.method, headers, redirect: "manual", proxy, signal: AbortSignal.timeout(25_000) });
    reads++;
    const clean = new Headers(upstream.headers);
    for (const name of ["set-cookie", "set-auth-token", "access-control-expose-headers"]) clean.delete(name);
    clean.set("cache-control", "private, no-store");
    return new Response(upstream.body, { status: upstream.status, headers: clean });
  } catch { return new Response("Upstream unavailable", { status: 502 }); }
} });
event("session_issued", { publicId, expiresAt, authMode: "ssh-operator", businessReadonly: true });
async function shutdown() {
  closing ??= (async () => { server.stop(true); await revoke(); await pool.end(); })();
  return closing;
}
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => { void shutdown().then(() => process.exit(0), () => process.exit(1)); });
setTimeout(() => { void shutdown().then(() => process.exit(0), () => process.exit(1)); }, 10 * 60_000).unref();

}
await main().catch((error) => { console.error(JSON.stringify({ event: "bridge_failed", runId: process.env.SMOKE_RUN_ID, kind: error.name, frames: String(error.stack).split("\n").filter(x => x.trim().startsWith("at ")).slice(0, 4) })); process.exit(1); });
