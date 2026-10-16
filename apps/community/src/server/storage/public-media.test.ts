import { exportTestUserIds } from "../testing/user-public-ids";
import { beforeAll, afterAll, expect, test } from "bun:test";
import { getRequestListener } from "@hono/node-server";
import { createServer, get as rawHttpGet } from "node:http";
import { eq, sql } from "drizzle-orm";
import { createApp } from "../app";
import { user, userAvatars, blobBlocks, mediaPublications } from "../db/schema";
import { testAppDeps } from "../testing/app-deps";
import {
  createTestAuth,
  UNLIMITED,
  currentUserId,
  googleProfile,
  signInWithGoogle,
  signInWithQq,
} from "../testing/auth";
import { Browser } from "../testing/auth-browser";
import { TEST_PUBLIC_ORIGIN } from "../testing/constants";
import { resetTestDatabase, testDbHandle } from "../testing/test-db";
import { readyContext, readyOwner, readyFile, digest } from "../../../test/storage/ready-file";
import { cleanupStorageFixture, storageFixtureConfig } from "../../../test/storage/fixture";
import { createS3Driver } from "./s3";
import { setAvatar } from "./avatars";
import { createMediaDrain } from "./drain";
import { canonicalMediaHash, createPublicMediaHandler } from "./public-media";
const real = test.skipIf(!process.env.STORAGE_TEST_FIXTURE_PATH);
let fixture: Awaited<ReturnType<typeof readyContext>>;
const owners: string[] = [];
beforeAll(async () => {
  await resetTestDatabase();
  fixture = await readyContext();
}, 30000);
afterAll(async () => {
  if (fixture)
    await cleanupStorageFixture(
      fixture.ctx.db,
      owners,
      [fixture.policy.id],
      process.env.STORAGE_TEST_FIXTURE_PATH
        ? createS3Driver(await storageFixtureConfig("control"))
        : undefined,
      true,
    );
}, 30000);
async function own() {
  const id = await readyOwner(fixture.ctx);
  owners.push(id);
  return id;
}
function setup() {
  const { ctx } = fixture;
  const { auth, outbox } = createTestAuth({ qqLimits: UNLIMITED });
  const base = testAppDeps({ auth }).deps;
  const secret = "internalMediaSecret" in ctx.config ? ctx.config.internalMediaSecret : "";
  const drain = createMediaDrain({ db: ctx.db, secret });
  const app = createApp({
    ...base,
    mediaDrain: drain,
    services: { ...base.services, storage: ctx },
  });
  return { auth, outbox, app, drain, secret, browser: new Browser(app) };
}
async function login(browser: Browser) {
  const profile = googleProfile({ picture: "https://never-fetch.example/image.jpg" });
  await signInWithGoogle(browser, profile);
  const id = await currentUserId(browser);
  owners.push(id);
  return { id, profile };
}
function internal(
  drain: ReturnType<typeof createMediaDrain>,
  secret: string,
  op: string,
  hash: string,
  generation: number,
) {
  return drain.handle(
    new Request(`http://internal/internal/media/${op}`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      body: JSON.stringify({ hash, generation }),
    }),
  );
}
async function publication(hash: string) {
  return (
    await fixture.ctx.db
      .select()
      .from(mediaPublications)
      .where(eq(mediaPublications.outputSha256, hash))
  )[0];
}
test("canonical raw URLs reject queries including bare markers, encoded paths, methods and uppercase", () => {
  const hash = "a".repeat(64),
    path = `/media/${hash}.jpg`;
  expect(canonicalMediaHash(new Request(`http://x${path}`))).toBe(hash);
  for (const tail of ["?", "?x=1", "?%3f", "#fragment", "/", "?=", "%3f"]) {
    const r = new Request(`http://x${path}${tail}`);
    expect(canonicalMediaHash(r)).toBeNull();
  }
  for (const path of [
    `/media/${hash.toUpperCase()}.jpg`,
    `/media/%61${hash.slice(1)}.jpg`,
    `/media/${hash}.%6apg`,
    `/media/${hash}.JPG`,
  ])
    expect(canonicalMediaHash(new Request(`http://x${path}`))).toBeNull();
  expect(canonicalMediaHash(new Request(`http://x${path}`, { method: "POST" }))).toBeNull();
});
real(
  "actual Bun HTTP/S3: public derived only, accurate headers/range/validators, owner-private denial before conditional",
  async () => {
    const { ctx, policy } = fixture;
    const { app, browser } = setup();
    const { id } = await login(browser);
    const f = await readyFile(ctx, policy.id, id);
    await setAvatar(ctx, id, { fileId: f.file.id, expectedRevision: 0 }, crypto.randomUUID());
    await ctx.db.execute(
      sql`update session set updated_at=now()-interval '2 days', expires_at=now()+interval '28 days' where user_id=${id}`,
    );
    const server = createServer(getRequestListener(app.fetch, { overrideGlobalObjects: false }));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("HTTP address");
    const origin = `http://127.0.0.1:${address.port}`,
      path = `/media/${f.derived.outputSha256}.jpg`,
      etag = `"sha256-${f.derived.outputSha256}"`;
    try {
      const get = async (path: string, headers: Record<string, string> = {}, method = "GET") =>
        fetch(origin + path, { method, headers: { cookie: browser.cookieHeader(), ...headers } });
      const response = await get(path);
      expect(response.status).toBe(200);
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect(digest(bytes)).toBe(f.derived.outputSha256);
      expect(response.headers.get("content-type")).toBe("image/jpeg");
      expect(
        Number(response.headers.get("content-length")),
        JSON.stringify([...response.headers]),
      ).toBe(bytes.length);
      expect(response.headers.get("etag")).toBe(etag);
      expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
      expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(response.headers.get("vary")).toBeNull();
      expect(response.headers.get("content-disposition")).toBeNull();
      for (const [range, start, end] of [
        ["bytes=2-5", 2, 5],
        ["bytes=-4", bytes.length - 4, bytes.length - 1],
        ["bytes=4-", 4, bytes.length - 1],
      ] as const) {
        const r = await get(path, { range });
        expect(r.status).toBe(206);
        expect(r.headers.get("content-range")).toBe(`bytes ${start}-${end}/${bytes.length}`);
        expect(new Uint8Array(await r.arrayBuffer())).toEqual(bytes.slice(start, end + 1));
      }
      for (const range of ["bytes=9999999-", "bytes=0-1,3-4"]) {
        const r = await get(path, { range });
        expect(r.status).toBe(416);
        expect(r.headers.get("content-range")).toBe(`bytes */${bytes.length}`);
        expect(r.headers.get("cache-control")).toBe("private, no-store");
        await r.text();
      }
      for (const rawTarget of [
        `/media/x/../${f.derived.outputSha256}.jpg`,
        `/media/x/%2e%2e/${f.derived.outputSha256}.jpg`,
        `/x/../media/${f.derived.outputSha256}.jpg`,
      ]) {
        const raw = await new Promise<{
          status: number | undefined;
          headers: import("node:http").IncomingHttpHeaders;
        }>((resolve) => {
          rawHttpGet(
            {
              hostname: "127.0.0.1",
              port: address.port,
              path: rawTarget,
              headers: { cookie: browser.cookieHeader() },
            },
            (response) => {
              response.resume();
              response.on("end", () =>
                resolve({ status: response.statusCode, headers: response.headers }),
              );
            },
          );
        });
        expect(raw.status).toBe(404);
        expect(raw.headers["cache-control"]).toBe("private, no-store");
        expect(raw.headers["set-cookie"]).toBeUndefined();
      }
      const head = await get(path, {}, "HEAD");
      expect(head.status).toBe(200);
      expect(await head.text()).toBe("");
      expect(head.headers.get("content-length")).toBe(String(bytes.length));
      expect((await get(path, { "if-none-match": etag })).status).toBe(304);
      const mismatch = await get(path, { range: "bytes=2-5", "if-range": "wrong" });
      expect(mismatch.status).toBe(200);
      await mismatch.arrayBuffer();
      const match = await get(path, { range: "bytes=2-5", "if-range": etag });
      expect(match.status).toBe(206);
      await match.arrayBuffer();
      for (const bad of [
        `${path}?`,
        `${path}?x`,
        `/me%64ia/${f.derived.outputSha256}.jpg`,
        `/media%2f${f.derived.outputSha256}.jpg`,
        "/media",
        `/media/${f.blob.sha256}.jpg`,
        `/media/%${f.derived.outputSha256.charCodeAt(0).toString(16)}${f.derived.outputSha256.slice(1)}.jpg`,
      ]) {
        const r = await get(bad, { "if-none-match": etag, range: "bytes=0-3" });
        expect(r.status).toBe(404);
        expect(r.headers.get("cache-control")).toBe("private, no-store");
        expect(r.headers.get("set-cookie")).toBeNull();
        await r.text();
      }
      const content = await get(`/api/v1/files/${f.file.id}/content`, { range: "bytes=2-5" });
      expect(content.status).toBe(206);
      expect(content.headers.get("content-range")).toBe(`bytes 2-5/${f.original.length}`);
      expect(content.headers.get("content-disposition")).toContain(
        "filename*=UTF-8''%E7%85%A7%E7%89%87%E3%83%BB%E7%94%BB%E5%83%8F%F0%9F%98%80%22.png",
      );
      expect(content.headers.get("cache-control")).toBe("private, no-store");
      expect(content.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
      expect(new Uint8Array(await content.arrayBuffer())).toEqual(f.original.slice(2, 6));
      const preview = await get(`/api/v1/files/${f.file.id}/preview`);
      expect(digest(new Uint8Array(await preview.arrayBuffer()))).toBe(f.derived.outputSha256);
      const other = new Browser(app);
      await login(other);
      for (const method of ["GET", "HEAD"]) {
        const r = await fetch(`${origin}/api/v1/files/${f.file.id}/content`, {
          method,
          headers: {
            cookie: other.cookieHeader(),
            range: "bytes=0-3",
            "if-none-match": `"sha256-${f.blob.sha256}"`,
          },
        });
        expect(r.status).toBe(404);
        expect(r.headers.get("cache-control")).toBe("private, no-store");
        await r.text();
      }
      await ctx.db.insert(blobBlocks).values({ sha256: f.blob.sha256, reasonCode: "test" });
      const blocked = await get(path, { "if-none-match": etag, range: "bytes=0-3" });
      expect(blocked.status).toBe(404);
      await blocked.text();
      await ctx.db.delete(blobBlocks).where(eq(blobBlocks.sha256, f.blob.sha256));
      await setAvatar(ctx, id, { fileId: null, expectedRevision: 1 }, crypto.randomUUID());
      const removed = await get(path, { "if-none-match": etag });
      expect(removed.status).toBe(404);
      expect(removed.headers.get("cache-control")).toBe("private, no-store");
      await removed.text();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    }
  },
);
real("ready DB with missing S3 bytes returns 503, including conditional requests", async () => {
  const { ctx, policy } = fixture;
  const id = await own();
  const f = await readyFile(ctx, policy.id, id);
  await setAvatar(ctx, id, { fileId: f.file.id, expectedRevision: 0 }, crypto.randomUUID());
  const control = createS3Driver(await storageFixtureConfig("control"));
  await control.delete({ bucket: "derived", key: f.derived.key });
  const media = createPublicMediaHandler(ctx, createMediaDrain({ db: ctx.db, secret: "test" }));
  const response = await media(
    new Request(`http://x/media/${f.derived.outputSha256}.jpg`, {
      headers: { "if-none-match": `"sha256-${f.derived.outputSha256}"` },
    }),
  );
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
real(
  "registration precedes real PG permission barrier; drain denies old lookup and generation resume repairs publication",
  async () => {
    const { ctx, policy } = fixture;
    const { app, browser, drain, secret } = setup();
    const { id } = await login(browser);
    const f = await readyFile(ctx, policy.id, id);
    expect(
      (
        await browser.request("PUT", "/api/v1/me/avatar", {
          body: { fileId: f.file.id, expectedRevision: 0 },
          headers: { "idempotency-key": crypto.randomUUID() },
        })
      ).status,
    ).toBe(200);
    const initial = await publication(f.derived.outputSha256);
    const pool = testDbHandle().pool,
      query = pool.query;
    let release!: () => void, reached!: () => void;
    const barrier = new Promise<void>((r) => (release = r)),
      hit = new Promise<void>((r) => (reached = r));
    let held = false;
    pool.query = ((...args: unknown[]) => {
      const text =
        typeof args[0] === "object" ? String((args[0] as { text?: string }).text) : String(args[0]);
      const result = Reflect.apply(query, pool, args);
      if (!held && text.includes('from "media_publications" inner join')) {
        held = true;
        return Promise.resolve(result).then(async (value) => {
          reached();
          await barrier;
          return value;
        });
      }
      return result;
    }) as typeof pool.query;
    try {
      const pending = app.request(`/media/${f.derived.outputSha256}.jpg`, {
        headers: { cookie: browser.cookieHeader() },
      });
      await hit;
      await setAvatar(ctx, id, { fileId: null, expectedRevision: 1 }, crypto.randomUUID());
      const revoked = await publication(f.derived.outputSha256);
      expect(
        (await internal(drain, secret, "drain", f.derived.outputSha256, revoked.generation)).status,
      ).toBe(200);
      release();
      const response = await pending;
      expect(response.status).toBe(404);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    } finally {
      release();
      pool.query = query;
    }
    const revoked = await publication(f.derived.outputSha256);
    expect(
      (await internal(drain, secret, "resume", f.derived.outputSha256, initial.generation)).status,
    ).toBe(404);
    // Task7 convergence fixture; only transitions the persisted publication after real drain.
    await ctx.db
      .update(mediaPublications)
      .set({ state: "private" })
      .where(eq(mediaPublications.outputSha256, f.derived.outputSha256));
    expect(
      (
        await browser.request("PUT", "/api/v1/me/avatar", {
          body: { fileId: f.file.id, expectedRevision: 2 },
          headers: { "idempotency-key": crypto.randomUUID() },
        })
      ).status,
    ).toBe(200);
    const reopened = await app.request(`/media/${f.derived.outputSha256}.jpg`);
    expect(reopened.status).toBe(200);
    await reopened.arrayBuffer();
    expect(
      (await internal(drain, secret, "drain", f.derived.outputSha256, revoked.generation)).status,
    ).toBe(404);
    expect(
      (
        await drain.handle(
          new Request("http://internal/internal/media/drain", {
            method: "POST",
            headers: { cookie: browser.cookieHeader() },
            body: JSON.stringify({ hash: f.derived.outputSha256, generation: revoked.generation }),
          }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request("/internal/media/drain", {
          method: "POST",
          headers: { authorization: `Bearer ${secret}` },
          body: "{}",
        })
      ).status,
    ).toBe(404);
  },
);
real(
  "real S3 permits and drain registrations survive response creation through EOF/cancel",
  async () => {
    const { ctx, policy } = fixture,
      id = await own(),
      f = await readyFile(ctx, policy.id, id);
    await setAvatar(ctx, id, { fileId: f.file.id, expectedRevision: 0 }, crypto.randomUUID());
    const driver = createS3Driver(ctx.config, { readLimit: 1 }),
      bounded = { ...ctx, driver };
    const drain = createMediaDrain({ db: ctx.db, secret: "test" });
    let releases = 0,
      registrations = 0;
    const tracking = {
      ...drain,
      register(hash: string) {
        const ticket = drain.register(hash);
        if (!ticket) return null;
        registrations++;
        let done = false;
        return {
          ...ticket,
          release() {
            if (!done) {
              done = true;
              releases++;
              ticket.release();
            }
          },
        };
      },
    };
    const media = createPublicMediaHandler(bounded, tracking);
    const req = new Request(`http://x/media/${f.derived.outputSha256}.jpg`);
    const response = await media(req);
    expect(registrations).toBe(1);
    expect(releases).toBe(0);
    await expect(driver.head({ bucket: "derived", key: f.derived.key })).rejects.toMatchObject({
      status: 503,
    });
    await response.arrayBuffer();
    expect(releases).toBe(1);
    expect((await driver.head({ bucket: "derived", key: f.derived.key }))?.size).toBe(
      f.output.length,
    );
    const cancelled = await media(req);
    expect(releases).toBe(1);
    await cancelled.body!.cancel();
    expect(releases).toBe(2);
    expect((await driver.head({ bucket: "derived", key: f.derived.key }))?.size).toBe(
      f.output.length,
    );
    const head = await media(new Request(req.url, { method: "HEAD" }));
    expect(head.status).toBe(200);
    expect(head.body).toBeNull();
    expect(releases).toBe(3);
    const conditional = await media(
      new Request(req.url, { headers: { "if-none-match": `"sha256-${f.derived.outputSha256}"` } }),
    );
    expect(conditional.status).toBe(304);
    expect(releases).toBe(4);
    const inFlight = await media(req);
    await setAvatar(ctx, id, { fileId: null, expectedRevision: 1 }, crypto.randomUUID());
    await drain.drain(
      f.derived.outputSha256,
      (await publication(f.derived.outputSha256)).generation,
    );
    await expect(inFlight.arrayBuffer()).rejects.toBeDefined();
    expect(releases).toBe(5);
    expect((await driver.head({ bucket: "derived", key: f.derived.key }))?.size).toBe(
      f.output.length,
    );
  },
);
test("real BetterAuth direct API/internalAdapter/provider updates cannot bypass explicit association; profile agrees", async () => {
  const { ctx, policy } = fixture;
  const { app, auth, browser, outbox } = setup();
  const { id, profile } = await login(browser);
  const f = await readyFile(ctx, policy.id, id);
  const headers = new Headers({ cookie: browser.cookieHeader(), origin: TEST_PUBLIC_ORIGIN });
  const { internalAdapter } = await auth.$context;
  for (const image of [
    null,
    "",
    "https://remote.example/image",
    `/media/${"a".repeat(64)}.jpg`,
    42,
    { url: "x" },
  ])
    await expect(auth.api.updateUser({ headers, body: { image } as never })).rejects.toMatchObject({
      body: { code: "AVATAR_EXPLICIT_REQUIRED" },
    });
  expect((await ctx.db.select().from(user).where(eq(user.id, id)))[0].image).toBeNull();
  expect(await ctx.db.select().from(userAvatars).where(eq(userAvatars.userId, id))).toHaveLength(0);
  expect((await browser.request("GET", "/api/v1/me/profile")).json).toMatchObject({
    image: null,
    avatarRevision: 0,
  });
  const key = crypto.randomUUID();
  expect(
    (
      await browser.request("PUT", "/api/v1/me/avatar", {
        body: { fileId: f.file.id, expectedRevision: 0 },
        headers: { "idempotency-key": key },
      })
    ).status,
  ).toBe(200);
  const snapshot = await ctx.db.select().from(userAvatars).where(eq(userAvatars.userId, id));
  const pub = await publication(f.derived.outputSha256);
  for (const image of [null, "https://remote.example/image"]) {
    await expect(internalAdapter.updateUser(id, { image })).rejects.toMatchObject({
      body: { code: "AVATAR_EXPLICIT_REQUIRED" },
    });
    await expect(
      internalAdapter.updateUserByEmail(`${id}@placeholder.invalid`, { image }),
    ).rejects.toMatchObject({ body: { code: "AVATAR_EXPLICIT_REQUIRED" } });
    await expect(auth.api.updateUser({ headers, body: { image } })).rejects.toMatchObject({
      body: { code: "AVATAR_EXPLICIT_REQUIRED" },
    });
  }
  expect(
    (await browser.request("POST", "/api/auth/update-user", { body: { image: null } })).status,
  ).toBe(404);
  expect(await auth.api.updateUser({ headers, body: { name: "new name" } })).toBeDefined();
  await internalAdapter.updateUser(id, { emailVerified: true });
  const read = await browser.request("GET", "/api/v1/me/profile");
  expect(read.json).toMatchObject({
    image: `/media/${f.derived.outputSha256}.jpg`,
    avatarRevision: 1,
  });
  await browser.request("PATCH", "/api/v1/me/profile", {
    body: { image: "https://remote.example/x", bio: "hi" },
  });
  expect(
    (
      await signInWithGoogle(browser, {
        ...profile,
        picture: "https://never-fetch.example/new.jpg",
      })
    ).status,
  ).toBe(302);
  expect((await signInWithGoogle(browser, profile, { link: true })).status).toBe(302);
  expect(
    (
      await signInWithGoogle(
        browser,
        googleProfile({ picture: "https://never-fetch.example/link.jpg" }),
        { link: true },
      )
    ).status,
  ).toBe(302);
  expect(await ctx.db.select().from(userAvatars).where(eq(userAvatars.userId, id))).toEqual(
    snapshot,
  );
  expect(await publication(f.derived.outputSha256)).toEqual(pub);
  await exportTestUserIds();
  expect((await browser.request("GET", "/api/v1/me")).json.image).toBe(
    `/media/${f.derived.outputSha256}.jpg`,
  );
  expect((await browser.request("GET", "/api/auth/get-session")).json.user.image).toBe(
    `/media/${f.derived.outputSha256}.jpg`,
  );
  expect((await browser.request("GET", `/api/v1/users/${id}`)).json.image).toBe(
    `/media/${f.derived.outputSha256}.jpg`,
  );
  const qq = new Browser(app);
  const q = await signInWithQq(qq, outbox);
  expect(q.verified.status).toBe(200);
  const qid = await currentUserId(qq);
  owners.push(qid);
  expect((await ctx.db.select().from(user).where(eq(user.id, qid)))[0].image).toBeNull();
  const qf = await readyFile(ctx, policy.id, qid);
  await setAvatar(ctx, qid, { fileId: qf.file.id, expectedRevision: 0 }, crypto.randomUUID());
  await signInWithQq(qq, outbox, q.qq);
  expect((await ctx.db.select().from(user).where(eq(user.id, qid)))[0].image).toBe(
    `/media/${qf.derived.outputSha256}.jpg`,
  );
});

test("media registrations cap permissions/streams at32 and saturation is503 without a waiting queue", async () => {
  const { ctx } = fixture;
  const drain = createMediaDrain({ db: ctx.db, secret: "test" }),
    hash = "a".repeat(64);
  const tickets = Array.from({ length: 32 }, () => drain.register(hash)!);
  const media = createPublicMediaHandler(ctx, drain);
  const response = await media(new Request(`http://x/media/${hash}.jpg`));
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  tickets[0].release();
  // Actual PG query failure while occupying the32nd permission-registration slot.
  const pool = testDbHandle().pool,
    query = pool.query;
  pool.query = ((..._args: unknown[]) =>
    Reflect.apply(query, pool, [
      { text: "select * from task6_nonexistent_permission_table", rowMode: "array" },
    ])) as typeof pool.query;
  try {
    const failed = await media(new Request(`http://x/media/${hash}.jpg`));
    expect(failed.status).toBe(503);
    expect(failed.headers.get("cache-control")).toBe("private, no-store");
  } finally {
    pool.query = query;
  }
  const next = drain.register(hash);
  expect(next).not.toBeNull();
  next!.release();
  for (const ticket of tickets) ticket.release();
  const final = drain.register(hash);
  expect(final).not.toBeNull();
  final!.release();
});

test("unconfigured storage denies canonical and invalid media with no-store before sessions", async () => {
  const { deps } = testAppDeps();
  const app = createApp(deps);
  const hash = "a".repeat(64);
  for (const target of [
    `/media/${hash}.jpg`,
    `/media/${hash}.jpg?`,
    `/media/${hash}.jpg?x=1`,
    `/media/%61${hash.slice(1)}.jpg`,
    `/me%64ia/${hash}.jpg`,
    `/media%2f${hash}.jpg`,
    "/media",
  ]) {
    const response = await app.request(target, { headers: { cookie: "session=invalid" } });
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("vary")).toBeNull();
  }
});

real("an old drain result cannot latch or abort a newer resumed public generation", async () => {
  const { ctx, policy } = fixture;
  const { app, browser, drain, secret } = setup();
  const { id } = await login(browser);
  const f = await readyFile(ctx, policy.id, id);
  const hash = f.derived.outputSha256;
  await setAvatar(ctx, id, { fileId: f.file.id, expectedRevision: 0 }, crypto.randomUUID());
  await setAvatar(ctx, id, { fileId: null, expectedRevision: 1 }, crypto.randomUUID());
  const old = await publication(hash);
  const pool = testDbHandle().pool;
  // This client will be next from the idle pool. Hold the actual SELECT result,
  // for both pool-query (unlocked implementation) and transaction-client paths.
  const client = await pool.connect();
  const query = client.query;
  let release!: () => void, reached!: () => void;
  const barrier = new Promise<void>((r) => (release = r));
  const hit = new Promise<void>((r) => (reached = r));
  let held = false;
  client.query = ((...args: unknown[]) => {
    const text =
      typeof args[0] === "object" ? String((args[0] as { text?: string }).text) : String(args[0]);
    if (!held && text.includes('from "media_publications" where')) {
      held = true;
      const last = args.at(-1);
      if (typeof last === "function") {
        args[args.length - 1] = async (error: unknown, value: unknown) => {
          if (!error) {
            reached();
            await barrier;
          }
          last(error, value);
        };
        return Reflect.apply(query, client, args);
      }
      return Promise.resolve(Reflect.apply(query, client, args)).then(async (value) => {
        reached();
        await barrier;
        return value;
      });
    }
    return Reflect.apply(query, client, args);
  }) as typeof client.query;
  client.release();
  let stopWatch = false;
  const pending = internal(drain, secret, "drain", hash, old.generation);
  let republished: Promise<Response> | undefined;
  try {
    await hit;
    republished = (async () => {
      // Task7 convergence followed by the real API publication/resume path.
      await ctx.db
        .update(mediaPublications)
        .set({ state: "private" })
        .where(eq(mediaPublications.outputSha256, hash));
      const saved = await browser.request("PUT", "/api/v1/me/avatar", {
        body: { fileId: f.file.id, expectedRevision: 2 },
        headers: { "idempotency-key": crypto.randomUUID() },
      });
      expect(saved.status).toBe(200);
      return app.request(`/media/${hash}.jpg`);
    })();
    const blocked = (async () => {
      for (let i = 0; i < 100 && !stopWatch; i++) {
        const result = await ctx.db.execute(sql`
          select exists(select 1 from pg_stat_activity
            where datname=current_database() and wait_event_type='Lock'
            and query like 'update "media_publications"%') as waiting`);
        if (result.rows[0]?.waiting) return "blocked" as const;
        await Bun.sleep(5);
      }
      if (!stopWatch) throw new Error("Publication neither completed nor waited on PG lock");
      return "stopped" as const;
    })();
    const phase = await Promise.race([republished.then(() => "published" as const), blocked]);
    stopWatch = true;
    release();
    const ack = await pending;
    // Unlocked obsolete snapshots must be denied. Locked validation may ACK
    // first, before the higher-generation transition is allowed to complete.
    expect(ack.status).toBe(phase === "published" ? 404 : 200);
    const response = await republished;
    expect(response.status).toBe(200);
    expect(digest(new Uint8Array(await response.arrayBuffer()))).toBe(hash);
    const after = await app.request(`/media/${hash}.jpg`);
    expect(after.status).toBe(200);
    await after.arrayBuffer();
    expect((await publication(hash)).generation).toBeGreaterThan(old.generation);
  } finally {
    stopWatch = true;
    release();
    client.query = query;
    await pending;
    const unfinished = await republished;
    if (unfinished && !unfinished.bodyUsed) await unfinished.body?.cancel();
  }
});
