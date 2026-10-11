import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { createApp } from "../app";
import { eq } from "drizzle-orm";
import { uploadSessions, uploadParts, storagePolicies } from "../db/schema";
import { testAppDeps } from "../testing/app-deps";
import { googleProfile, signInWithGoogle, currentUserId } from "../testing/auth";
import { Browser } from "../testing/auth-browser";
import { resetTestDatabase, testDbHandle } from "../testing/test-db";
import { cleanupStorageFixture, storageFixtureConfig } from "../../../test/storage/fixture";
import { initUpload } from "../storage/uploads";
import type { StorageContext } from "../storage/contracts";
import { createS3Driver } from "../storage/s3";
import { isUploadPartRequest, putUploadPart } from "../storage/parts";
import { createMemoryRateLimitStore } from "../middleware/rate-limit";
const hash = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
beforeAll(resetTestDatabase, 30000);
const fixtureOwners: string[] = [];
const fixturePolicies: string[] = [];
afterAll(() => cleanupStorageFixture(testDbHandle().db, fixtureOwners, fixturePolicies), 30000);
async function fixture() {
  const { deps } = testAppDeps();
  const config = await storageFixtureConfig();
  const driver = { ...createS3Driver(config), put: async () => {} };
  const ctx: StorageContext = {
    db: testDbHandle().db,
    config,
    driver,
    boss: deps.services.boss,
    log: deps.log,
  };
  const [policy] = await ctx.db
    .insert(storagePolicies)
    .values({
      name: crypto.randomUUID(),
      endpoint: config.endpoint,
      region: config.region,
      originalBucket: config.originalBucket,
      derivedBucket: config.derivedBucket,
      credentialsRef: config.credentialsRef,
    })
    .returning({ id: storagePolicies.id });
  fixturePolicies.push(policy.id);
  deps.services.storage = ctx;
  const calls: string[] = [];
  const memory = createMemoryRateLimitStore();
  deps.rateLimitStore = {
    hit: async (k, w) => {
      calls.push(k);
      return memory.hit(k, w);
    },
  };
  const app = createApp(deps);
  const browser = new Browser(app);
  await signInWithGoogle(browser, googleProfile());
  const owner = await currentUserId(browser);
  fixtureOwners.push(owner);
  return { app, browser, ctx, owner, calls, deps };
}
function request(path: string, body: Uint8Array, headers: Record<string, string>, method = "PUT") {
  return new Request(`https://community.example.test${path}`, {
    method,
    headers,
    body: body as Uint8Array<ArrayBuffer>,
  });
}
test("only exact UUID part routes qualify for binary exception", () => {
  const path = `/api/v1/uploads/${crypto.randomUUID()}/parts/0`;
  expect(isUploadPartRequest("PUT", path)).toBe(true);
  for (const route of [
    `${path}/`,
    `${path}/extra`,
    path.replace("/0", "/00"),
    path.replace("/0", "/115"),
    path.replace("/parts/", "/other/"),
    "/api/v1/uploads/no/parts/0",
  ])
    expect(isUploadPartRequest("PUT", route)).toBe(false);
  expect(isUploadPartRequest("POST", path)).toBe(false);
});
test("binary HTTP length, hash, CSRF, ownership and sibling limits", async () => {
  const f = await fixture();
  const bytes = new Uint8Array(4194304);
  const upload = await initUpload(
    f.ctx,
    f.owner,
    {
      purpose: "avatar",
      name: "photo.png",
      size: bytes.length,
      sha256: hash(bytes),
    },
    crypto.randomUUID(),
  );
  const path = `/api/v1/uploads/${upload.id.toUpperCase()}/parts/0`;
  const headers = {
    cookie: f.browser.cookieHeader(),
    origin: f.deps.publicOrigin,
    "content-type": "application/octet-stream",
    "x-part-sha256": hash(bytes),
    "content-length": String(bytes.length),
  };
  expect((await f.app.request(request(path, bytes, headers))).status).toBe(204);
  expect(
    (await f.app.request(request(path, bytes, { ...headers, origin: "https://evil.test" }))).status,
  ).toBe(403);
  const missing = { ...headers };
  delete (missing as Partial<typeof headers>)["content-length"];
  expect((await f.app.request(request(path, bytes, missing))).status).toBe(411);
  expect(
    (await f.app.request(request(path, bytes, { ...headers, "content-length": "wat" }))).status,
  ).toBe(400);
  expect(
    (await f.app.request(request(path, bytes, { ...headers, "content-length": "3" }))).status,
  ).toBe(400);
  expect((await f.app.request(request(path, new Uint8Array(4194305), headers))).status).toBe(413);
  expect(
    (await f.app.request(request(path, bytes, { ...headers, "x-part-sha256": "0".repeat(64) })))
      .status,
  ).toBe(400);
  expect((await f.app.request(request(`${path}/extra`, bytes, headers))).status).toBe(415);
  expect(
    (
      await f.app.request(
        request(`${path}/extra`, bytes, {
          ...headers,
          "content-type": "application/json",
        }),
      )
    ).status,
  ).toBe(413);
  expect(
    (
      await f.app.request(`/api/v1/uploads/${upload.id}`, {
        method: "HEAD",
        headers: { cookie: f.browser.cookieHeader() },
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await f.app.request(`/api/v1/uploads/${upload.id}/complete`, {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
          "content-length": "2",
        },
        body: "{}",
      })
    ).status,
  ).toBe(202);
  expect(f.calls.filter((k) => k.startsWith("rl:upload-parts-user:")).length).toBeGreaterThan(0);
  expect(f.calls.filter((k) => k.startsWith("rl:api-ip:")).length).toBeGreaterThan(0);
});

test("parts use 120/minute without the write bucket; other writes and initialization keep their limits", async () => {
  const f = await fixture();
  const data = new Uint8Array([7]);
  const upload = await initUpload(
    f.ctx,
    f.owner,
    { purpose: "avatar", name: "a.png", size: 1, sha256: hash(data) },
    crypto.randomUUID(),
  );
  const path = `/api/v1/uploads/${upload.id}/parts/0`;
  const headers = {
    cookie: f.browser.cookieHeader(),
    origin: f.deps.publicOrigin,
    "content-type": "application/octet-stream",
    "content-length": "1",
    "x-part-sha256": hash(data),
  };
  const seen: { key: string; window: number }[] = [];
  let partCount = 119;
  f.deps.rateLimitStore.hit = async (key, window) => {
    seen.push({ key, window });
    return {
      count: key.startsWith("rl:upload-parts-user:")
        ? ++partCount
        : key.startsWith("rl:api-user-write:")
          ? 61
          : 1,
      resetSec: window,
    };
  };
  expect((await f.app.request(request(path, data, headers))).status).toBe(204);
  expect((await f.app.request(request(path, data, headers))).status).toBe(429);
  expect(seen.some((x) => x.key.startsWith("rl:api-user-write:"))).toBe(false);
  expect(seen.filter((x) => x.key.startsWith("rl:api-ip:"))).toHaveLength(2);
  expect(seen.find((x) => x.key.startsWith("rl:upload-parts-user:"))?.window).toBe(60);
  expect(
    (
      await f.browser.request("PATCH", "/api/v1/me/profile", {
        body: { bio: "x" },
      })
    ).status,
  ).toBe(429);
  for (const bucket of ["upload-init-user", "upload-init-ip"]) {
    f.deps.rateLimitStore.hit = async (key, window) => ({
      count: key.startsWith(`rl:${bucket}:`) ? (bucket.endsWith("user") ? 11 : 61) : 1,
      resetSec: window,
    });
    expect(
      (
        await f.browser.request("POST", "/api/v1/uploads", {
          body: { purpose: "avatar", name: "a", size: 1, sha256: hash(data) },
          headers: { "idempotency-key": crypto.randomUUID() },
        })
      ).status,
    ).toBe(429);
  }
});
test("two concurrent parts per user; saturation releases permits and generic IP still applies", async () => {
  const f = await fixture();
  const data = new Uint8Array([4]);
  const ids = await Promise.all(
    [1, 2].map(() =>
      initUpload(
        f.ctx,
        f.owner,
        { purpose: "avatar", name: "a", size: 1, sha256: hash(data) },
        crypto.randomUUID(),
      ),
    ),
  );
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((r) => (enter = r));
  const held = new Promise<void>((r) => (release = r));
  let started = 0;
  f.ctx.driver.put = async () => {
    if (++started === 2) enter();
    await held;
  };
  const headers = {
    cookie: f.browser.cookieHeader(),
    origin: f.deps.publicOrigin,
    "content-type": "application/octet-stream",
    "content-length": "1",
    "x-part-sha256": hash(data),
  };
  const path = (i: number) => `/api/v1/uploads/${ids[i].id}/parts/0`;
  const requests = ids.map((_, i) => f.app.request(request(path(i), data, headers)));
  await entered;
  try {
    expect((await f.app.request(request(path(0), data, headers))).status).toBe(503);
  } finally {
    release();
  }
  expect((await Promise.all(requests)).map((r) => r.status)).toEqual([204, 204]);
  expect((await f.app.request(request(path(0), data, headers))).status).toBe(204);
  f.deps.rateLimitStore.hit = async (key, window) => ({
    count: key.startsWith("rl:api-ip:") ? 301 : 1,
    resetSec: window,
  });
  expect((await f.app.request(request(path(0), data, headers))).status).toBe(429);
});
test("real Bun and Node development adapter transport accepts 4MiB parts and preserves empty DELETE", async () => {
  const f = await fixture();
  const data = new Uint8Array(4194304);
  const upload = await initUpload(
    f.ctx,
    f.owner,
    { purpose: "avatar", name: "a", size: data.length, sha256: hash(data) },
    crypto.randomUUID(),
  );
  const path = `/api/v1/uploads/${upload.id}/parts/0`;
  const headers = {
    cookie: f.browser.cookieHeader(),
    origin: f.deps.publicOrigin,
    "content-type": "application/octet-stream",
    "x-part-sha256": hash(data),
  };
  const bun = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: f.app.fetch });
  try {
    expect(
      (
        await fetch(new URL(path, bun.url), {
          method: "PUT",
          headers,
          body: data,
        })
      ).status,
    ).toBe(204);
  } finally {
    await bun.stop(true);
  }
  const adapterRequire = createRequire(import.meta.resolve("react-router-hono-server/node"));
  const viteRequire = createRequire(adapterRequire.resolve("@hono/vite-dev-server"));
  const { serve } = viteRequire("@hono/node-server") as {
    serve(options: {
      fetch: typeof f.app.fetch;
      port: number;
      hostname: string;
    }): import("node:http").Server;
  };
  const nativeRequest = globalThis.Request;
  const nativeResponse = globalThis.Response;
  const server = serve({ fetch: f.app.fetch, port: 0, hostname: "127.0.0.1" });
  await new Promise<void>((resolve) =>
    server.listening ? resolve() : server.once("listening", resolve),
  );
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw Error("No port");
    const url = `http://127.0.0.1:${address.port}`;
    expect((await fetch(`${url}${path}`, { method: "PUT", headers, body: data })).status).toBe(204);
    expect(
      (
        await fetch(`${url}/api/v1/uploads/${upload.id}`, {
          method: "DELETE",
          headers: {
            cookie: f.browser.cookieHeader(),
            origin: f.deps.publicOrigin,
            "content-type": "application/json",
          },
        })
      ).status,
    ).toBe(204);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    globalThis.Request = nativeRequest;
    globalThis.Response = nativeResponse;
  }
});

test("slow request bodies take concurrency permits before the first byte is read", async () => {
  const f = await fixture();
  const data = new Uint8Array([9]);
  const upload = await initUpload(
    f.ctx,
    f.owner,
    { purpose: "avatar", name: "a", size: 1, sha256: hash(data) },
    crypto.randomUUID(),
  );
  const path = `/api/v1/uploads/${upload.id}/parts/0`;
  const headers = {
    cookie: f.browser.cookieHeader(),
    origin: f.deps.publicOrigin,
    "content-type": "application/octet-stream",
    "content-length": "1",
    "x-part-sha256": hash(data),
  };
  let reads = 0;
  let entered!: () => void;
  const enteredBoth = new Promise<void>((r) => (entered = r));
  const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
  const slow = () =>
    new Request(`https://community.example.test${path}`, {
      method: "PUT",
      headers,
      body: new ReadableStream<Uint8Array>(
        {
          start(c) {
            controllers.push(c);
          },
          pull() {
            if (++reads === 2) entered();
            return new Promise<void>(() => {});
          },
        },
        { highWaterMark: 0 },
      ),
      duplex: "half",
    } as RequestInit);
  const pending = [f.app.request(slow()), f.app.request(slow())];
  await enteredBoth;
  let thirdRead = false;
  const extra = new Request(`https://community.example.test${path}`, {
    method: "PUT",
    headers,
    body: new ReadableStream(
      {
        pull() {
          thirdRead = true;
        },
      },
      { highWaterMark: 0 },
    ),
    duplex: "half",
  } as RequestInit);
  try {
    expect((await f.app.request(extra)).status).toBe(503);
    expect(thirdRead).toBe(false);
  } finally {
    for (const c of controllers) {
      c.enqueue(data);
      c.close();
    }
  }
  const responses = await Promise.all(pending);
  expect(responses.every((r) => r.status === 204 || r.status === 409)).toBe(true);
});
test("owner GET/HEAD is private; stranger GET/HEAD returns404; authenticated bearer may upload without Origin", async () => {
  const f = await fixture();
  const other = new Browser(f.app);
  await signInWithGoogle(other, googleProfile());
  const data = new Uint8Array([6]);
  const upload = await initUpload(
    f.ctx,
    f.owner,
    { purpose: "avatar", name: "a", size: 1, sha256: hash(data) },
    crypto.randomUUID(),
  );
  for (const method of ["GET", "HEAD"]) {
    const response = await f.app.request(`/api/v1/uploads/${upload.id}`, {
      method,
      headers: { cookie: other.cookieHeader() },
    });
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  }
  const signed = [...f.browser.cookies.entries()].find(([key]) =>
    key.endsWith(".session_token"),
  )?.[1];
  if (!signed) throw Error("Missing signed session cookie");
  const response = await f.app.request(
    request(`/api/v1/uploads/${upload.id}/parts/0`, data, {
      authorization: `Bearer ${decodeURIComponent(signed)}`,
      "content-type": "application/octet-stream",
      "content-length": "1",
      "x-part-sha256": hash(data),
    }),
  );
  expect(response.status).toBe(204);
});

test("real slow HTTP bodies hold the global eight-request bound before buffering", async () => {
  const f = await fixture();
  const browsers = [f.browser];
  for (let i = 0; i < 4; i++) {
    const browser = new Browser(f.app);
    await signInWithGoogle(browser, googleProfile());
    browsers.push(browser);
  }
  const { request: httpRequest } = await import("node:http");
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: f.app.fetch });
  const path = `/api/v1/uploads/${crypto.randomUUID()}/parts/0`;
  const headers = (browser: Browser) => ({
    cookie: browser.cookieHeader(),
    origin: f.deps.publicOrigin,
    "content-type": "application/octet-stream",
    "content-length": "1",
    "x-part-sha256": hash(new Uint8Array([1])),
  });
  let admitted = 0;
  let signal!: () => void;
  const seen = new Promise<void>((r) => (signal = r));
  const original = f.deps.rateLimitStore.hit;
  f.deps.rateLimitStore.hit = async (key, window) => {
    const result = await original(key, window);
    if (key.startsWith("rl:upload-parts-user:") && ++admitted === 8) signal();
    return result;
  };
  const requests: import("node:http").ClientRequest[] = [];
  const responses: Array<Promise<number>> = [];
  try {
    for (const browser of browsers.slice(0, 4))
      for (let i = 0; i < 2; i++) {
        responses.push(
          new Promise((resolve) => {
            const req = httpRequest(
              new URL(path, server.url),
              { method: "PUT", headers: headers(browser) },
              (res) => {
                res.resume();
                res.on("end", () => resolve(res.statusCode ?? 0));
              },
            );
            requests.push(req);
            req.on("error", () => resolve(0));
            req.flushHeaders();
          }),
        );
      }
    await seen;
    const extra = await fetch(new URL(path, server.url), {
      method: "PUT",
      headers: headers(browsers[4]),
      body: new Uint8Array([1]),
    });
    expect(extra.status).toBe(503);
    for (const request of requests) request.end(new Uint8Array([1]));
    expect(await Promise.all(responses)).toEqual(Array(8).fill(404));
    const after = await fetch(new URL(path, server.url), {
      method: "PUT",
      headers: headers(browsers[4]),
      body: new Uint8Array([1]),
    });
    expect(after.status).toBe(404);
  } finally {
    for (const request of requests) request.destroy();
    await server.stop(true);
  }
});

test("HTTP init is idempotent, rejects changed bodies, and cancellation replays204", async () => {
  const f = await fixture();
  const key = crypto.randomUUID();
  const body = {
    purpose: "avatar",
    name: "../avatar.png",
    size: 3,
    sha256: hash(new Uint8Array([1, 2, 3])),
  };
  const first = await f.browser.request("POST", "/api/v1/uploads", {
    body,
    headers: { "idempotency-key": key },
  });
  expect(first.status).toBe(201);
  expect(first.json).toMatchObject({ state: "receiving", partCount: 1, receivedParts: [] });
  const replay = await f.browser.request("POST", "/api/v1/uploads", {
    body,
    headers: { "idempotency-key": key },
  });
  expect(replay.json).toEqual(first.json);
  expect(
    (
      await f.browser.request("POST", "/api/v1/uploads", {
        body: { ...body, size: 2 },
        headers: { "idempotency-key": key },
      })
    ).status,
  ).toBe(409);
  const headers = {
    cookie: f.browser.cookieHeader(),
    origin: f.deps.publicOrigin,
    "content-type": "application/octet-stream",
    "content-length": "1",
    "x-part-sha256": hash(new Uint8Array([1])),
  };
  expect(
    (
      await f.app.request(
        request(`/api/v1/uploads/${first.json.id}/parts/0`, new Uint8Array([1]), headers),
      )
    ).status,
  ).toBe(400);
  for (let n = 0; n < 2; n++)
    expect(
      (await f.browser.request("DELETE", `/api/v1/uploads/${first.json.id}`, { body: {} })).status,
    ).toBe(204);
});

test("complete HTTP returns incomplete409, processing202 and ready replay200 with owner-only access", async () => {
  const f = await fixture();
  const bytes = new Uint8Array([1, 2, 3]);
  const upload = await initUpload(
    f.ctx,
    f.owner,
    { purpose: "avatar", name: "a.png", size: bytes.length, sha256: hash(bytes) },
    crypto.randomUUID(),
  );
  const path = `/api/v1/uploads/${upload.id}/complete`;
  expect((await f.browser.request("POST", path, { body: {} })).status).toBe(409);
  await putUploadPart(f.ctx, f.owner, upload.id, 0, bytes, hash(bytes));
  await f.ctx.db
    .update(uploadParts)
    .set({ state: "writing" })
    .where(eq(uploadParts.uploadId, upload.id));
  expect((await f.browser.request("POST", path, { body: {} })).status).toBe(409);
  await f.ctx.db
    .update(uploadParts)
    .set({ state: "ready" })
    .where(eq(uploadParts.uploadId, upload.id));
  const a = await f.browser.request("POST", path, { body: {} });
  const b = await f.browser.request("POST", path, { body: {} });
  expect(a.status).toBe(202);
  expect(b.status).toBe(202);
  expect(a.json).toEqual(b.json);
  await f.ctx.db
    .update(uploadSessions)
    .set({ state: "ready" })
    .where(eq(uploadSessions.id, upload.id));
  expect((await f.browser.request("POST", path, { body: {} })).status).toBe(200);
  const other = await fixture();
  expect((await other.browser.request("POST", path, { body: {} })).status).toBe(404);
});
