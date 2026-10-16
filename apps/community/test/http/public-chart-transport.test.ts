import { test, expect } from "bun:test";
import { createServer, get } from "node:http";
import { once } from "node:events";
import { createHash, randomBytes } from "node:crypto";
import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { blobs, files, derivedObjects, blobDerivatives, user, storagePolicies, charts, chartPublicIds, chartVersions, chartPublications, blobBlocks, session, profiles } from "../../src/server/db/schema";
import { testDbHandle } from "../../src/server/testing/test-db";
import { startBuiltServer, HTTP_TEST_AUTH_SECRET } from "./server";
import { chartManifestBytes } from "../../src/server/charts/artifact";
import { CHART_PREVIEW_MIME } from "../../src/server/charts/recipe";
import type { ChartImportSummary, ChartPreviewManifest } from "../../src/shared/charts";
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

test("built anonymous charts: real S3 HTTP metadata/failures/hash blocks, bounded concurrent downloads, disconnect cancellation and SSR/data 503", async () => {
  const original = randomBytes(8388608), maidata = Buffer.from("&inote_4=(120){4}1,2,E\n");
  const summary: ChartImportSummary = { title: "Transport fixture", artist: "Synthetic", maidataMd5Base64: createHash("md5").update(maidata).digest("base64"), difficulties: [{ difficulty: 4, level: null, noteCount: 2, durationMs: 1000, previewSupported: true }], warnings: [], audio: null, hasCover: false };
  const manifest: ChartPreviewManifest = { format: 1, summary, assets: [{ role: "maidata", path: "maidata.txt", mime: "text/plain; charset=utf-8", size: maidata.length, offset: 0, sha256: hash(maidata) }] };
  const meta = chartManifestBytes(manifest), header = Buffer.alloc(12); header.write("ADXCPV1\0", "ascii"); header.writeUInt32LE(meta.length, 8);
  const artifact = Buffer.concat([header, meta, maidata]);
  let mode = "normal", active = 0, canceled = 0, hold = false;
  const upstream = createServer((req, res) => {
    if (mode === "unavailable") { res.writeHead(503); res.end(); return; }
    const derived = req.url?.startsWith("/derived/"), all = derived ? artifact : original;
    const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? "");
    const start = range ? Number(range[1]) : 0, end = range ? Number(range[2]) : all.length - 1;
    const bytes = all.subarray(start, end + 1);
    res.writeHead(range ? 206 : 200, { "content-length": bytes.length, "content-type": derived ? CHART_PREVIEW_MIME : "application/zip", "x-amz-meta-sha256": mode === "metadata" ? "0".repeat(64) : hash(all), ...(range ? { "content-range": `bytes ${start}-${end}/${all.length}` } : {}) });
    if (req.method === "HEAD") { res.end(); return; }
    active++; let offset = 0, timer: ReturnType<typeof setTimeout>;
    res.on("close", () => { clearTimeout(timer); active--; if (offset < bytes.length) canceled++; });
    const send = () => {
      if (res.destroyed) return;
      if (hold && offset) { timer = setTimeout(send, 10); return; }
      const next = Math.min(offset + 16384, bytes.length); const writable = res.write(bytes.subarray(offset, next)); offset = next;
      if (offset === bytes.length) res.end();
      else if (writable) timer = setTimeout(send, 2);
      else res.once("drain", () => { timer = setTimeout(send, 2); });
    }; send();
  });
  upstream.listen(0, "127.0.0.1"); await once(upstream, "listening");
  const endpoint = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  const server = await startBuiltServer({ STORAGE_S3_ENDPOINT: endpoint }); const { db } = testDbHandle();
  let renamed = false;
  try {
    const owner = crypto.randomUUID(); await db.insert(user).values({ id: owner, name: "Transport", email: `${owner}@placeholder.invalid` });
    const [policy] = await db.insert(storagePolicies).values({ name: crypto.randomUUID(), endpoint, region: "us-east-1", originalBucket: "blobs", derivedBucket: "derived", credentialsRef: "STORAGE_WEB" }).returning();
    const [blob] = await db.insert(blobs).values({ policyId: policy.id, sha256: hash(original), key: `sha256/${hash(original)}`, size: original.length, detectedMime: "application/zip", state: "ready", verifiedAt: new Date() }).returning();
    const [out] = await db.insert(derivedObjects).values({ policyId: policy.id, outputSha256: hash(artifact), key: `sha256/${hash(artifact)}`, size: artifact.length, mime: CHART_PREVIEW_MIME, state: "ready", properties: { chartPreview: manifest } }).returning();
    const [recipe] = await db.insert(blobDerivatives).values({ sourceBlobId: blob.id, recipe: "chart-preview-v1", recipeBuild: "fixture", derivedObjectId: out.id, state: "ready" }).returning();
    const [file] = await db.insert(files).values({ ownerId: owner, blobId: blob.id, originalName: "private-name.zip", purpose: "chart-source", size: original.length, state: "ready" }).returning();
    const [chart] = await db.insert(charts).values({ ownerId: owner, title: summary.title }).returning();
    const [version] = await db.insert(chartVersions).values({ chartId: chart.id, ordinal: 1, sourceFileId: file.id, previewDerivativeId: recipe.id, maidataMd5Base64: summary.maidataMd5Base64, summary }).returning();
    await db.update(charts).set({ currentVersionId: version.id }).where(eq(charts.id, chart.id));
    await db.insert(chartPublicIds).values({ chartId: chart.id });
    await db.insert(chartPublications).values({ chartId: chart.id, versionId: version.id, title: summary.title, artist: summary.artist, publishedAt: new Date(), updatedAt: new Date() });
    const token = crypto.randomUUID();
    await db.insert(profiles).values({ userId: owner, onboardedAt: new Date() });
    await db.insert(session).values({ userId: owner, token, expiresAt: new Date(Date.now() + 86400000) });
    const cookie = `adxc.session_token=${encodeURIComponent(`${token}.${await makeSignature(token, HTTP_TEST_AUTH_SECRET)}`)}`;
    const privatePage = await fetch(server.url(`/me/charts/${chart.id}`), { headers: { cookie } });
    expect(privatePage.status).toBe(200);
    expect(await privatePage.text()).toContain("公开发布");
    const base = `/api/v1/charts/${chart.id}`, urls = [`${base}/download`, `${base}/versions/${version.id}/assets/maidata`];
    for (const path of urls) {
      const response = await fetch(server.url(path)); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(Buffer.from(await response.arrayBuffer())).toEqual(path.endsWith("download") ? original : maidata);
    }
    for (mode of ["metadata", "unavailable"]) for (const path of urls) for (const method of ["GET", "HEAD"]) {
      const response = await fetch(server.url(path), { method, headers: { "if-none-match": "*" } });
      expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toBe("private, no-store"); await response.arrayBuffer();
    }
    mode = "normal";
    await db.insert(blobBlocks).values({ sha256: blob.sha256, reasonCode: "synthetic" });
    for (const path of [base, ...urls]) { const response = await fetch(server.url(path)); expect(response.status).toBe(404); expect(response.headers.get("cache-control")).toBe("private, no-store"); await response.arrayBuffer(); }
    await db.delete(blobBlocks).where(eq(blobBlocks.sha256, blob.sha256));
    hold = true;
    const open = () => new Promise<import("node:http").IncomingMessage>((resolve, reject) => { get(server.url(urls[0]), res => { res.pause(); resolve(res); }).on("error", reject); });
    const first = await open(), second = await open(); expect(first.statusCode).toBe(200); expect(second.statusCode).toBe(200);
    const full = await fetch(server.url(urls[0])); expect(full.status).toBe(429); expect(full.headers.get("retry-after")).toBe("2"); await full.arrayBuffer();
    first.destroy(); second.destroy();
    for (let i = 0; i < 100 && active; i++) await Bun.sleep(20);
    expect(active).toBe(0); expect(canceled).toBeGreaterThanOrEqual(2); hold = false;
    const retry = await fetch(server.url(urls[0]), { method: "HEAD" }); expect(retry.status).toBe(200);
    // Real upstream SQL failure in this disposable DB; restore schema in finally even if an assertion fails.
    await db.execute("alter table chart_publications rename to acceptance_unavailable_publications"); renamed = true;
    for (const path of [`/charts/${chart.id}`, `/charts/${chart.id}.data`, "/charts", "/charts.data"]) {
      const response = await fetch(server.url(path)); expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toBe("private, no-store");
      if (!path.endsWith(".data")) expect(await response.text()).toContain('name="robots" content="noindex"'); else await response.arrayBuffer();
    }
  } finally {
    hold = false;
    if (renamed) await db.execute("alter table acceptance_unavailable_publications rename to chart_publications");
    await server.stop(); upstream.closeAllConnections(); await new Promise<void>(resolve => upstream.close(() => resolve()));
  }
}, 60000);
