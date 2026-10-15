import { test, expect } from "bun:test";
import { createServer, get } from "node:http";
import { once } from "node:events";
import { createHash, randomBytes } from "node:crypto";
import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import {
  blobs,
  files,
  derivedObjects,
  blobDerivatives,
  user,
  session,
  storagePolicies,
  userAvatars,
  mediaPublications,
} from "../../src/server/db/schema";
import { testDbHandle } from "../../src/server/testing/test-db";
import { startBuiltServer, HTTP_TEST_AUTH_SECRET } from "./server";
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
/** Deliberately paced object HTTP fixture: actual built web, Node adapter, auth and PostgreSQL permissions. */
test("built Node server streams known lengths, backpressures, cancels private disconnect/public drain, and closes its only public listener", async () => {
  const original = randomBytes(8388608),
    output = randomBytes(524288),
    sha = hash(original),
    outSha = hash(output);
  let holdPublic = false, publicCanceled = 0;
  let active = 0,
    canceled = 0,
    sent = 0;
  const upstream = createServer((req, res) => {
    const bytes = req.url?.startsWith("/derived/") ? output : original;
    const digest = req.url?.startsWith("/derived/") ? outSha : sha;
    res.writeHead(200, {
      "content-length": bytes.length,
      "content-type": req.url?.startsWith("/derived/") ? "image/jpeg" : "image/png",
      "x-amz-meta-sha256": digest,
      etag: `"${digest}"`,
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    active++;
    let offset = 0,
      timer: ReturnType<typeof setTimeout> | undefined;
    res.on("close", () => {
      clearTimeout(timer);
      active--;
      if (offset < bytes.length) {
        canceled++;
        if (bytes === output) publicCanceled++;
      }
    });
    function send() {
      if (res.destroyed) return;
      if (bytes === output && holdPublic && offset > 0) {
        timer = setTimeout(send, 2);
        return;
      }
      const next = Math.min(offset + 16384, bytes.length);
      const ok = res.write(bytes.subarray(offset, next));
      sent += next - offset;
      offset = next;
      if (offset === bytes.length) {
        res.end();
        return;
      }
      if (ok) timer = setTimeout(send, 2);
      else
        res.once("drain", () => {
          timer = setTimeout(send, 2);
        });
    }
    send();
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const endpoint = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  const server = await startBuiltServer({ STORAGE_S3_ENDPOINT: endpoint });
  const { db } = testDbHandle();
  const owner = crypto.randomUUID(),
    token = crypto.randomUUID();
  const cookie = `adxc.session_token=${encodeURIComponent(`${token}.${await makeSignature(token, HTTP_TEST_AUTH_SECRET)}`)}`;
  try {
    await db
      .insert(user)
      .values({
        id: owner,
        name: "transport",
        email: `${owner}@placeholder.invalid`,
        image: `/media/${outSha}.jpg`,
      });
    await db
      .insert(session)
      .values({ userId: owner, token, expiresAt: new Date(Date.now() + 86400000) });
    const [policy] = await db
      .insert(storagePolicies)
      .values({
        name: crypto.randomUUID(),
        endpoint,
        region: "us-east-1",
        originalBucket: "blobs",
        derivedBucket: "derived",
        credentialsRef: "STORAGE_WEB",
      })
      .returning();
    const [blob] = await db
      .insert(blobs)
      .values({
        policyId: policy.id,
        sha256: sha,
        key: `sha256/${sha}`,
        size: original.length,
        detectedMime: "image/png",
        state: "ready",
        verifiedAt: new Date(),
      })
      .returning();
    const [out] = await db
      .insert(derivedObjects)
      .values({
        policyId: policy.id,
        outputSha256: outSha,
        key: `sha256/${outSha}`,
        size: output.length,
        mime: "image/jpeg",
        state: "ready",
      })
      .returning();
    const [recipe] = await db
      .insert(blobDerivatives)
      .values({
        sourceBlobId: blob.id,
        recipe: "avatar-v1",
        recipeBuild: "test-v1",
        derivedObjectId: out.id,
        state: "ready",
      })
      .returning();
    const [file] = await db
      .insert(files)
      .values({
        ownerId: owner,
        blobId: blob.id,
        originalName: "fixture.png",
        purpose: "avatar",
        size: original.length,
        state: "ready",
        retainedUntil: new Date(Date.now() + 86400000),
      })
      .returning();
    await db
      .insert(userAvatars)
      .values({ userId: owner, fileId: file.id, derivativeId: recipe.id, revision: 1 });
    await db
      .insert(mediaPublications)
      .values({ outputSha256: outSha, state: "public", generation: 1 });
    const privateUrl = server.url(`/api/v1/files/${file.id}/content`),
      publicUrl = server.url(`/media/${outSha}.jpg`);
    expect((await fetch(server.url("/privacy"))).status).toBe(200);
    expect((await fetch(privateUrl)).status).toBe(401);
    for (const [url, bytes, headers] of [
      [privateUrl, original, { cookie }],
      [publicUrl, output, {}],
    ] as const) {
      const response = await fetch(url, { headers });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-length")).toBe(String(bytes.length));
      expect(hash(new Uint8Array(await response.arrayBuffer()))).toBe(hash(bytes));
    }
    const paused = await new Promise<import("node:http").IncomingMessage>((resolve, reject) => {
      get(privateUrl, { headers: { cookie } }, (res) => {
        res.pause();
        resolve(res);
      }).on("error", reject);
    });
    const before = sent;
    await Bun.sleep(1400);
    const after = sent;
    await Bun.sleep(300);
    expect(after - before).toBeLessThan(original.length);
    expect(sent - after).toBeLessThan(1048576);
    paused.destroy();
    const cut = await fetch(privateUrl, { headers: { cookie } });
    const reader = cut.body!.getReader();
    await reader.read();
    await reader.cancel();
    // Keep this response in flight even if the revocation transaction takes longer than EOF.
    const publicCanceledBefore = publicCanceled;
    const internal = Number(new URL(server.origin).port) + 10000;
    holdPublic = true;
    const streaming = await fetch(publicUrl);
    const publicReader = streaming.body!.getReader();
    try {
      await publicReader.read();
      await db
        .update(mediaPublications)
        .set({ state: "revoking", generation: 2 })
        .where(eq(mediaPublications.outputSha256, outSha));
      const drained = await fetch(`http://127.0.0.1:${internal}/internal/media/drain`, {
        method: "POST",
        headers: {
          authorization: "Bearer http-test-internal-media-secret-0123456789",
          "content-type": "application/json",
        },
        body: JSON.stringify({ hash: outSha, generation: 2 }),
      });
      expect(drained.status).toBe(200);
      for (let i = 0; i < 50 && (active || publicCanceled === publicCanceledBefore); i++) await Bun.sleep(20);
      // No client cancellation or release may supply this proof of server-side drain.
      expect(publicCanceled).toBe(publicCanceledBefore + 1);
      expect(active).toBe(0);
      expect(canceled).toBeGreaterThanOrEqual(3);
    } finally {
      await publicReader.cancel().catch(() => {});
      holdPublic = false;
    }
    expect((await fetch(publicUrl)).status).toBe(404);
    expect((await fetch(server.url("/internal/media/drain"), { method: "POST" })).status).toBe(404);
    expect((await fetch(server.url("/api/v1/me"), {method:"PATCH",headers:{cookie,origin:server.origin,"content-type":"application/json"},body:JSON.stringify({name:"x".repeat(65536)})})).status).toBe(413);
    const rawAlias=await new Promise<number>((resolve,reject)=>{const u=new URL(server.origin);get({hostname:u.hostname,port:u.port,path:`/media/../media/${outSha}.jpg`},res=>{res.resume();resolve(res.statusCode!);}).on("error",reject);});
    expect(rawAlias).toBe(404);
    await db.update(mediaPublications).set({state:"public",generation:3}).where(eq(mediaPublications.outputSha256,outSha));
    const resumed=await fetch(`http://127.0.0.1:${internal}/internal/media/resume`,{method:"POST",headers:{authorization:"Bearer http-test-internal-media-secret-0123456789","content-type":"application/json"},body:JSON.stringify({hash:outSha,generation:3})});
    expect(resumed.status).toBe(200);
    const shutdownRead=await fetch(publicUrl);const shutdownReader=shutdownRead.body!.getReader();await shutdownReader.read();
    await server.stop();
    await shutdownReader.cancel().catch(()=>{});
    for(let i=0;i<50&&active;i++)await Bun.sleep(20);
    expect(active).toBe(0);
    await expect(fetch(server.url("/healthz"))).rejects.toThrow();
    expect(
      (await db.execute("select * from storage_runtime_roles where role='web'")).rows,
    ).toHaveLength(0);
  } finally {
    await server.stop();
    upstream.closeAllConnections();
    await new Promise<void>((r) => upstream.close(() => r()));
  }
}, 30000);
