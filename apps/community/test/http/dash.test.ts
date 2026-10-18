import { afterAll, beforeAll, expect, test } from "bun:test";
import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { shortId } from "../../src/server/auth/short-id";
import { session, user, userPublicIds } from "../../src/server/db/schema";
import { prepareTestQueues } from "../../src/server/testing/test-boss";
import { testDbHandle } from "../../src/server/testing/test-db";
import { exportTestUserIds } from "../../src/server/testing/user-public-ids";
import { HTTP_TEST_AUTH_SECRET, type RunningServer, startBuiltServer } from "./server";

async function seedIdentity(name: string) {
  const { db } = testDbHandle();
  const id = shortId();
  const email = `${id}@private-admin-fixture.invalid`;
  await db.insert(user).values({ id, name, email });
  const token = crypto.randomUUID().replaceAll("-", "");
  await db.insert(session).values({ token, userId: id, expiresAt: new Date(Date.now() + 86400000) });
  await exportTestUserIds();
  const [identity] = await db.select().from(userPublicIds).where(eq(userPublicIds.userId, id));
  if (!identity) throw new Error("Expected durable public user identifier");
  const signed = `${token}.${await makeSignature(token, HTTP_TEST_AUTH_SECRET)}`;
  return { id, email, publicId: identity.publicId.toString(), cookie: `adxc.session_token=${encodeURIComponent(signed)}` };
}
let server: RunningServer;
let admin: Awaited<ReturnType<typeof seedIdentity>>;
let ordinary: Awaited<ReturnType<typeof seedIdentity>>;
beforeAll(async () => {
  await prepareTestQueues();
  admin = await seedIdentity("HTTP dashboard administrator");
  ordinary = await seedIdentity("HTTP dashboard ordinary user");
  server = await startBuiltServer({ COMMUNITY_ADMIN_PUBLIC_IDS: admin.publicId });
}, 60000);
afterAll(async () => { await server?.stop(); });

function expectPrivate(response: Response, path: string) {
  expect(response.headers.get("cache-control"), path).toBe("private, no-store");
  expect(response.headers.get("x-robots-tag"), path).toBe("noindex, nofollow");
}

test("anonymous dashboard documents and data responses stay private in each locale", async () => {
  for (const prefix of ["", "/en", "/ja"]) for (const suffix of ["", "/users", "/charts", "/status", "/reports"]) {
    const path = `${prefix}/dash${suffix}`;
    const document = await fetch(server.url(path), { redirect: "manual" });
    expect(document.status, path).toBe(302);
    const destination = new URL(document.headers.get("location")!, server.origin);
    expect(destination.pathname).toBe(`${prefix}/login`);
    expect(destination.searchParams.get("next")).toBe(path);
    expectPrivate(document, path);
    await document.text();
    const data = await fetch(server.url(`${path}.data`), { redirect: "manual" });
    expectPrivate(data, `${path}.data`);
    expect(await data.text()).not.toContain("HTTP dashboard administrator");
  }
});

test("ordinary sessions cannot read dashboard documents, single-fetch data or administrative APIs", async () => {
  for (const prefix of ["", "/en", "/ja"]) for (const suffix of ["", "/users", "/charts", "/status", "/reports"]) {
    const path = `${prefix}/dash${suffix}`;
    for (const extension of ["", ".data"]) {
      const response = await fetch(server.url(`${path}${extension}`), { headers: { cookie: ordinary.cookie }, redirect: "manual" });
      expect(response.status, `${path}${extension}`).toBe(403);
      expectPrivate(response, `${path}${extension}`);
      const body = await response.text();
      expect(body).not.toContain(admin.email);
      expect(body).not.toContain("管理员 #");
      expect(body).not.toContain("HTTP dashboard administrator");
    }
  }
  for (const endpoint of ["access", "overview", "users", "charts", "status", "reports"]) {
    const response = await fetch(server.url(`/api/v1/dash/${endpoint}`), { headers: { cookie: ordinary.cookie } });
    expect(response.status, endpoint).toBe(403);
    expectPrivate(response, endpoint);
    expect(await response.json()).toEqual({ error: { code: "FORBIDDEN", message: "Forbidden" } });
  }
});

test("authorized users read localized dashboard documents and data with no-store/noindex headers", async () => {
  for (const prefix of ["", "/en", "/ja"]) for (const suffix of ["", "/users", "/charts"]) {
    const path = `${prefix}/dash${suffix}`;
    for (const extension of ["", ".data"]) {
      const response = await fetch(server.url(`${path}${extension}`), { headers: { cookie: admin.cookie } });
      expect(response.status, `${path}${extension}`).toBe(200);
      expectPrivate(response, `${path}${extension}`);
      const body = await response.text();
      expect(body).not.toContain(ordinary.email);
      if (!extension) {
        expect(body).toContain('<meta name="robots" content="noindex, nofollow"/>');
        expect(body).toContain(`${prefix}/dash/users`);
        expect(body).toContain(`${prefix}/dash/charts`);
      }
    }
  }
});

test("private collection documents and APIs are no-store even when anonymous", async () => {
  for (const prefix of ["", "/en", "/ja"]) for (const name of ["favorites", "reports"]) {
    const path = `${prefix}/me/${name}`;
    const response = await fetch(server.url(path), { redirect: "manual" });
    expect(response.status).toBe(302); expectPrivate(response, path); await response.text();
    const api = await fetch(server.url(`/api/v1/me/${name}`));
    expect(api.status).toBe(401); expectPrivate(api, name); await api.text();
  }
});
