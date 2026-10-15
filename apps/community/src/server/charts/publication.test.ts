import { mkdtemp, writeFile } from "node:fs/promises";
import { initializeJournal, exportJournal } from "../../../ops/backup/journal";
import { testDatabaseUrl } from "../testing/services";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { ChartImportSummary, ChartPreviewManifest } from "@/shared/charts";
import {
  charts,
  chartVersions,
  chartPublications,
  blobs,
  blobDerivatives,
  derivedObjects,
  files,
  storageBudget,
  storageUsage,
} from "../db/schema";
import { resetTestDatabase } from "../testing/test-db";
import { prepareTestQueues } from "../testing/test-boss";
import { readyContext, readyOwner as readyOwnerFixture } from "../../../test/storage/ready-file";
import { chartManifestBytes } from "./artifact";
import { recipeBuildFor, CHART_PREVIEW_MIME } from "./recipe";
import { createChart as createChartInService } from "./service";
import { chartRoutes } from "../api/charts";
import { StorageError } from "../storage/errors";
import type { AppEnv } from "../app-env";
import { cleanupStorageFixture } from "../../../test/storage/fixture";
const owners: string[] = [];
const chartIds: string[] = [];
async function readyOwner(...args: Parameters<typeof readyOwnerFixture>) {
  const id = await readyOwnerFixture(...args);
  owners.push(id);
  return id;
}
async function createChart(...args: Parameters<typeof createChartInService>) {
  const chart = await createChartInService(...args);
  chartIds.push(chart.id);
  return chart;
}
afterAll(async () => {
  if (!fixture) return;
  const { db } = fixture.ctx;
  if (chartIds.length) {
    await db.delete(chartPublications).where(inArray(chartPublications.chartId, chartIds));
    await db.update(charts).set({ currentVersionId: null }).where(inArray(charts.id, chartIds));
    await db.delete(chartVersions).where(inArray(chartVersions.chartId, chartIds));
    await db.delete(charts).where(inArray(charts.id, chartIds));
  }
  await cleanupStorageFixture(db, owners, [fixture.policy.id], undefined, true);
}, 30000);
const objects = new Map<string, { bytes: Buffer; mime: string; sha256: string }>();
let fixture: Awaited<ReturnType<typeof readyContext>>;
beforeAll(async () => {
  await resetTestDatabase();
  await prepareTestQueues();
  fixture = await readyContext();
  const directory = await mkdtemp("/tmp/chart-journal-");
  const keyFile = `${directory}/key`;
  await writeFile(keyFile, crypto.getRandomValues(new Uint8Array(32)), { mode: 0o600 });
  const journal = { directory: `${directory}/log`, keyFile, databaseUrl: testDatabaseUrl() };
  // Other integration files can replay their own historical checkpoints in the shared test DB.
  const { storageJournalProgress } = await import("../db/schema");
  await fixture.ctx.db
    .update(storageJournalProgress)
    .set({ exportedSequence: 0, chainHash: null, exportedAt: null })
    .where(eq(storageJournalProgress.id, "global"));
  await initializeJournal(journal);
  fixture.ctx.driver = {
    ...fixture.ctx.driver,
    async head({ key }) {
      const o = objects.get(key);
      return o ? { size: o.bytes.length, mime: o.mime, sha256: o.sha256 } : null;
    },
    async get({ key, range }) {
      const o = objects.get(key)!;
      const bytes = range ? o.bytes.subarray(range.start, range.end + 1) : o.bytes;
      return {
        size: bytes.length,
        mime: o.mime,
        sha256: o.sha256,
        body: new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(bytes);
            c.close();
          },
        }),
      };
    },
  };
  fixture.ctx.exportChartJournal = async () => {
    await exportJournal(journal);
  };
}, 30000);
async function chartFile(
  ownerId: string,
  input: {
    title?: string;
    build?: string;
    state?: "ready" | "processing";
    purpose?: "avatar" | "chart-source";
  } = {},
) {
  const { ctx, policy } = fixture;
  const original = Buffer.from(crypto.randomUUID());
  const sourceSha = createHash("sha256").update(original).digest("hex");
  const maidata = Buffer.from(
    `&title=${input.title ?? ""}\n&inote_4=(120){4}1,2,E\n${crypto.randomUUID()}`,
  );
  const summary: ChartImportSummary = {
    title: input.title ?? "",
    artist: "",
    maidataMd5Base64: createHash("md5").update(maidata).digest("base64"),
    difficulties: [
      { difficulty: 4, level: null, noteCount: 2, durationMs: 1000, previewSupported: true },
    ],
    warnings: [],
    audio: null,
    hasCover: false,
  };
  const manifest: ChartPreviewManifest = {
    format: 1,
    assets: [
      {
        role: "maidata",
        path: "maidata.txt",
        mime: "text/plain; charset=utf-8",
        size: maidata.length,
        sha256: createHash("sha256").update(maidata).digest("hex"),
        offset: 0,
      },
    ],
    summary,
  };
  const meta = chartManifestBytes(manifest),
    header = Buffer.alloc(12);
  header.write("ADXCPV1\0", "ascii");
  header.writeUInt32LE(meta.length, 8);
  const artifact = Buffer.concat([header, meta, maidata]),
    outputSha = createHash("sha256").update(artifact).digest("hex");
  const [blob] = await ctx.db
    .insert(blobs)
    .values({
      policyId: policy.id,
      sha256: sourceSha,
      key: `sha256/${sourceSha}`,
      size: original.length,
      state: "ready",
      detectedMime: "application/zip",
      verifiedAt: new Date(),
    })
    .returning();
  const [output] = await ctx.db
    .insert(derivedObjects)
    .values({
      policyId: policy.id,
      outputSha256: outputSha,
      key: `sha256/${outputSha}`,
      size: artifact.length,
      mime: CHART_PREVIEW_MIME,
      state: "ready",
      properties: { chartPreview: manifest },
    })
    .returning();
  const [recipe] = await ctx.db
    .insert(blobDerivatives)
    .values({
      sourceBlobId: blob.id,
      recipe: "chart-preview-v1",
      recipeBuild: input.build ?? recipeBuildFor(ctx, "chart-source"),
      derivedObjectId: output.id,
      state: "ready",
    })
    .returning();
  const state = input.state ?? "ready";
  const [file] = await ctx.db
    .insert(files)
    .values({
      ownerId,
      blobId: blob.id,
      originalName: "filename fallback.zip",
      purpose: input.purpose ?? "chart-source",
      size: original.length,
      state,
      retainedUntil: new Date(Date.now() + 86400000),
    })
    .returning();
  await ctx.db
    .insert(storageUsage)
    .values({ userId: ownerId, usedBytes: state === "ready" ? file.size : 0 })
    .onConflictDoUpdate({
      target: storageUsage.userId,
      set: { usedBytes: sql`${storageUsage.usedBytes}+${state === "ready" ? file.size : 0}` },
    });
  await ctx.db
    .update(storageBudget)
    .set({
      originalWritten: sql`${storageBudget.originalWritten}+${file.size}`,
      derivedWritten: sql`${storageBudget.derivedWritten}+${output.size}`,
    })
    .where(eq(storageBudget.id, "global"));
  objects.set(blob.key, { bytes: original, mime: "application/zip", sha256: blob.sha256 });
  objects.set(output.key, {
    bytes: artifact,
    mime: CHART_PREVIEW_MIME,
    sha256: output.outputSha256,
  });
  return { file, blob, output, recipe, summary, artifact, original };
}

test("private DTO explicitly reports unpublished state and publication requires original archive confirmation", async () => {
  const id = await readyOwner(fixture.ctx),
    source = await chartFile(id),
    chart = await createChart(fixture.ctx, id, source.file.id);
  expect(chart).toHaveProperty("publication", null);
});
test("author publication route binds the explicitly selected version", async () => {
  const id = await readyOwner(fixture.ctx),
    source = await chartFile(id),
    chart = await createChart(fixture.ctx, id, source.file.id);
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("services", { storage: fixture.ctx } as never);
    c.set("auth", { user: { id } } as never);
    await next();
  });
  app.route("/charts", chartRoutes);
  app.onError((e, c) =>
    c.json(
      { code: e instanceof StorageError ? e.code : "ERROR" },
      e instanceof StorageError ? (e.status as 400) : 500,
    ),
  );
  const response = await app.request(`/charts/${chart.id}/publication`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      expectedRevision: chart.revision,
      versionId: chart.currentVersionId,
      confirmOriginalArchive: true,
    }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    publication: { versionId: chart.currentVersionId },
  });
});

test("publication selects version, snapshots text, enforces CAS and deletion guard, and withdraws idempotently", async () => {
  const { publishChart, withdrawChart, getPublicChart, listPublicCharts } = await import(
    "./publication"
  );
  const { appendChartVersion, updateChart, deleteChartVersion } = await import("./service");
  const ctx = fixture.ctx,
    id = await readyOwner(ctx),
    a = await chartFile(id, { title: "A" }),
    b = await chartFile(id, { title: "B" });
  let chart = await createChart(ctx, id, a.file.id);
  const first = chart.currentVersionId;
  await expect(getPublicChart(ctx, chart.id)).rejects.toMatchObject({ status: 404 });
  chart = await appendChartVersion(ctx, id, chart.id, {
    fileId: b.file.id,
    expectedRevision: chart.revision,
  });
  await expect(
    publishChart(ctx, id, chart.id, {
      expectedRevision: chart.revision,
      versionId: first,
      confirmOriginalArchive: false,
    }),
  ).rejects.toMatchObject({ status: 400 });
  chart = await publishChart(ctx, id, chart.id, {
    expectedRevision: chart.revision,
    versionId: first,
    confirmOriginalArchive: true,
  });
  expect((await getPublicChart(ctx, chart.id)).versionId).toBe(first);
  expect(JSON.stringify(await getPublicChart(ctx, chart.id))).not.toContain("sourceFileId");
  expect(JSON.stringify(await getPublicChart(ctx, chart.id))).not.toContain("placeholder.invalid");
  const stable = await publishChart(ctx, id, chart.id, {
    expectedRevision: chart.revision,
    versionId: first,
    confirmOriginalArchive: true,
  });
  expect(stable.revision).toBe(chart.revision);
  chart = await updateChart(ctx, id, chart.id, {
    expectedRevision: chart.revision,
    title: "Private edit",
  });
  expect((await getPublicChart(ctx, chart.id)).title).toBe("A");
  await expect(
    publishChart(ctx, id, chart.id, {
      expectedRevision: 1,
      versionId: first,
      confirmOriginalArchive: true,
    }),
  ).rejects.toMatchObject({ code: "CHART_CHANGED" });
  await expect(deleteChartVersion(ctx, id, chart.id, first, chart.revision)).rejects.toMatchObject({
    code: "CHART_PUBLISHED_VERSION",
  });
  for (const input of [
    { limit: 51 },
    { limit: 0 },
    { cursor: "a".repeat(257) },
    { cursor: "invalid" },
  ])
    await expect(listPublicCharts(ctx, input)).rejects.toMatchObject({ status: 400 });
  chart = await withdrawChart(ctx, id, chart.id, chart.revision);
  expect(chart.publication).toBeNull();
  expect((await withdrawChart(ctx, id, chart.id, chart.revision)).revision).toBe(chart.revision);
  await expect(getPublicChart(ctx, chart.id)).rejects.toMatchObject({ status: 404 });
});

test("failed durable export closes access and a retry exports the same withdrawal", async () => {
  const { publishChart, withdrawChart, getPublicChart } = await import("./publication");
  const ctx = fixture.ctx,
    id = await readyOwner(ctx),
    source = await chartFile(id);
  let c = await createChart(ctx, id, source.file.id);
  c = await publishChart(ctx, id, c.id, {
    expectedRevision: c.revision,
    versionId: c.currentVersionId,
    confirmOriginalArchive: true,
  });
  const failed = {
    ...ctx,
    exportChartJournal: async () => {
      throw new Error("offline");
    },
  };
  await expect(withdrawChart(failed, id, c.id, c.revision)).rejects.toMatchObject({ status: 503 });
  const { getChart } = await import("./service");
  expect(await getChart(ctx, id, c.id)).toMatchObject({
    publicationPending: true,
    publication: null,
  });
  await expect(getPublicChart(ctx, c.id)).rejects.toMatchObject({ status: 404 });
  expect(await withdrawChart(ctx, id, c.id, c.revision)).toMatchObject({
    publicationPending: false,
    publication: null,
  });
});
test("cooling-off hides publication, cancellation restores it and final retention preserves only the public version anonymously", async () => {
  const { publishChart, getPublicChart } = await import("./publication");
  const { appendChartVersion } = await import("./service");
  const { requestDeletion, cancelDeletion, purgeUser } = await import("../services/user-deletion");
  const { createDeletionHandlers } = await import("../storage/deletion");
  const { retainsFile } = await import("../storage/references");
  const { user, chartVersions } = await import("../db/schema");
  const ctx = fixture.ctx,
    id = await readyOwner(ctx),
    a = await chartFile(id),
    b = await chartFile(id);
  let c = await createChart(ctx, id, a.file.id);
  const first = c.currentVersionId;
  c = await appendChartVersion(ctx, id, c.id, { fileId: b.file.id, expectedRevision: c.revision });
  c = await publishChart(ctx, id, c.id, {
    expectedRevision: c.revision,
    versionId: first,
    confirmOriginalArchive: true,
  });
  const deps = { db: ctx.db, boss: ctx.boss, handlers: createDeletionHandlers(ctx) };
  await requestDeletion(deps, id, { deleteContent: false });
  await expect(getPublicChart(ctx, c.id)).rejects.toMatchObject({ status: 404 });
  await cancelDeletion(deps, id);
  expect((await getPublicChart(ctx, c.id)).versionId).toBe(first);
  await requestDeletion(deps, id, { deleteContent: false });
  await ctx.db
    .update(user)
    .set({ deletionPurgeAt: new Date(Date.now() - 1000) })
    .where(eq(user.id, id));
  expect(await purgeUser(deps, id)).toBe("purged");
  expect((await getPublicChart(ctx, c.id)).author).toBeNull();
  expect(await retainsFile(ctx.db, a.file.id)).toBe(true);
  expect(await retainsFile(ctx.db, b.file.id)).toBe(false);
  expect((await ctx.db.select().from(files).where(eq(files.id, a.file.id)))[0]).toMatchObject({
    ownerId: null,
    originalName: "removed",
    state: "ready",
  });
  expect(
    await ctx.db.select().from(chartVersions).where(eq(chartVersions.id, c.currentVersionId)),
  ).toHaveLength(0);
});

test("anonymous HTTP authorizes before HEAD, Range, conditional responses and asset reads", async () => {
  const { publicChartRoutes } = await import("../api/public-charts");
  const { publishChart, withdrawChart } = await import("./publication");
  const ctx = fixture.ctx,
    id = await readyOwner(ctx),
    a = await chartFile(id, { title: "Public / title" });
  let c = await createChart(ctx, id, a.file.id);
  c = await publishChart(ctx, id, c.id, {
    expectedRevision: c.revision,
    versionId: c.currentVersionId,
    confirmOriginalArchive: true,
  });
  const data = new Map([
    [a.blob.key, { bytes: a.original, mime: "application/zip", sha256: a.blob.sha256 }],
    [a.output.key, { bytes: a.artifact, mime: CHART_PREVIEW_MIME, sha256: a.output.outputSha256 }],
  ]);
  const memory = {
    ...ctx,
    driver: {
      ...ctx.driver,
      async head({ key }: { key: string }) {
        const d = data.get(key);
        return d ? { size: d.bytes.length, mime: d.mime, sha256: d.sha256 } : null;
      },
      async get({ key, range }: { key: string; range?: { start: number; end: number } }) {
        const d = data.get(key)!;
        const bytes = range ? d.bytes.subarray(range.start, range.end + 1) : d.bytes;
        return {
          size: bytes.length,
          mime: d.mime,
          sha256: d.sha256,
          body: new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(bytes);
              c.close();
            },
          }),
        };
      },
    },
  };
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("services", { storage: memory } as never);
    c.set("clientIp", "public-test");
    await next();
  });
  app.route("/charts", publicChartRoutes);
  app.onError((e, c) =>
    c.json(
      { code: e instanceof StorageError ? e.code : "ERROR" },
      e instanceof StorageError ? (e.status as 400) : 500,
    ),
  );
  const path = `/charts/${c.id}/download`,
    etag = `"sha256-${a.blob.sha256}"`;
  const response = await app.request(path, { headers: { range: "bytes=0-3" } });
  expect(response.status).toBe(206);
  expect(Buffer.from(await response.arrayBuffer())).toEqual(a.original.subarray(0, 4));
  expect(response.headers.get("content-disposition")).not.toContain("filename fallback");
  expect((await app.request(path, { method: "HEAD" })).status).toBe(200);
  expect((await app.request(path, { headers: { "if-none-match": etag } })).status).toBe(304);
  const asset = await app.request(`/charts/${c.id}/versions/${c.currentVersionId}/assets/maidata`);
  expect(asset.status).toBe(200);
  expect(await asset.text()).toContain("&inote_4");
  await withdrawChart(ctx, id, c.id, c.revision);
  for (const init of [
    { method: "HEAD" },
    { headers: { range: "bytes=0-3" } },
    { headers: { "if-none-match": etag } },
  ] as RequestInit[]) {
    const denied = await app.request(path, init);
    expect(denied.status).toBe(404);
    expect(denied.headers.get("cache-control")).toBe("private, no-store");
  }
  expect(
    (await app.request(`/charts/${c.id}/versions/${c.currentVersionId}/assets/maidata`)).status,
  ).toBe(404);
});
test("anonymous streams reject excess work and cancellation releases the slot", async () => {
  const { createPublicStreamLimiter } = await import("./public-streams");
  const stream = createPublicStreamLimiter(),
    req = new Request("https://example.test");
  const operation = async () => new Response(new ReadableStream());
  const a = await stream("ip", req, operation),
    b = await stream("ip", req, operation);
  await expect(stream("ip", req, operation)).rejects.toMatchObject({ status: 429 });
  await a.body!.cancel();
  const c = await stream("ip", req, operation);
  await b.body!.cancel();
  await c.body!.cancel();
  const active = [];
  for (let i = 0; i < 16; i++) active.push(await stream(`ip-${i}`, req, operation));
  await expect(stream("extra", req, operation)).rejects.toMatchObject({ status: 429 });
  await Promise.all(active.map((r) => r.body!.cancel()));
});

test("replay against an old publication never restores a withdrawn or superseded version", async () => {
  const { publishChart, withdrawChart, getPublicChart } = await import("./publication");
  const { appendChartVersion } = await import("./service");
  const { charts, chartPublications, storageTombstones, storageJournalProgress } = await import(
    "../db/schema"
  );
  const { replayJournal } = await import("../../../ops/backup/restore");
  const { Client } = await import("pg");
  const ctx = fixture.ctx,
    id = await readyOwner(ctx),
    a = await chartFile(id),
    b = await chartFile(id);
  let c = await createChart(ctx, id, a.file.id);
  c = await publishChart(ctx, id, c.id, {
    expectedRevision: c.revision,
    versionId: c.currentVersionId,
    confirmOriginalArchive: true,
  });
  const [oldChart] = await ctx.db.select().from(charts).where(eq(charts.id, c.id)),
    [oldPub] = await ctx.db
      .select()
      .from(chartPublications)
      .where(eq(chartPublications.chartId, c.id));
  c = await appendChartVersion(ctx, id, c.id, { fileId: b.file.id, expectedRevision: c.revision });
  c = await publishChart(ctx, id, c.id, {
    expectedRevision: c.revision,
    versionId: c.currentVersionId,
    confirmOriginalArchive: true,
  });
  const [progress] = await ctx.db.select().from(storageJournalProgress);
  const records = (await ctx.db.select().from(storageTombstones))
    .filter(
      (r) =>
        r.kind === "chart_permission" &&
        r.payload &&
        "chartId" in r.payload &&
        r.payload.chartId === c.id,
    )
    .map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), payload: r.payload ?? undefined }));
  const client = new Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    await ctx.db.update(charts).set(oldChart).where(eq(charts.id, c.id));
    await ctx.db.update(chartPublications).set(oldPub).where(eq(chartPublications.chartId, c.id));
    await replayJournal(client, records, {
      sequence: progress.exportedSequence,
      hash: progress.chainHash!,
      capturedAt: progress.exportedAt!.toISOString(),
    });
    expect((await getPublicChart(ctx, c.id)).versionId).toBe(c.currentVersionId);
    c = await withdrawChart(ctx, id, c.id, c.revision);
    const [withdrawal] = await ctx.db
      .select()
      .from(storageTombstones)
      .where(
        eq(
          storageTombstones.sequence,
          (await ctx.db.select().from(charts).where(eq(charts.id, c.id)))[0].publicationSequence,
        ),
      );
    await ctx.db.update(charts).set(oldChart).where(eq(charts.id, c.id));
    await ctx.db.insert(chartPublications).values(oldPub);
    await replayJournal(
      client,
      [
        {
          ...withdrawal,
          createdAt: withdrawal.createdAt.toISOString(),
          payload: withdrawal.payload ?? undefined,
        },
      ],
      {
        sequence: withdrawal.sequence,
        hash: (await ctx.db.select().from(storageJournalProgress))[0].chainHash!,
        capturedAt: withdrawal.createdAt.toISOString(),
      },
    );
    await expect(getPublicChart(ctx, c.id)).rejects.toMatchObject({ status: 404 });
  } finally {
    await client.end();
  }
});

test("publish rejects another chart's version, blocked data, unready originals and missing physical objects", async () => {
  const { publishChart } = await import("./publication");
  const { blobBlocks } = await import("../db/schema");
  const ctx = fixture.ctx,
    id = await readyOwner(ctx),
    other = await readyOwner(ctx),
    a = await chartFile(id),
    b = await chartFile(other);
  const c = await createChart(ctx, id, a.file.id),
    foreign = await createChart(ctx, other, b.file.id),
    input = {
      expectedRevision: c.revision,
      versionId: c.currentVersionId,
      confirmOriginalArchive: true,
    };
  await expect(
    publishChart(ctx, id, c.id, { ...input, versionId: foreign.currentVersionId }),
  ).rejects.toMatchObject({ status: 404 });
  await ctx.db.insert(blobBlocks).values({ sha256: a.blob.sha256, reasonCode: "TEST" });
  await expect(publishChart(ctx, id, c.id, input)).rejects.toMatchObject({
    code: "CHART_FILE_NOT_READY",
  });
  await ctx.db.delete(blobBlocks).where(eq(blobBlocks.sha256, a.blob.sha256));
  await ctx.db.update(files).set({ state: "processing" }).where(eq(files.id, a.file.id));
  await expect(publishChart(ctx, id, c.id, input)).rejects.toMatchObject({
    code: "CHART_FILE_NOT_READY",
  });
  await ctx.db.update(files).set({ state: "ready" }).where(eq(files.id, a.file.id));
  const missing = { ...ctx, driver: { ...ctx.driver, head: async () => null } };
  await expect(publishChart(missing, id, c.id, input)).rejects.toMatchObject({ status: 503 });
});

test("restoring before final deletion retains only the latest permission and removes author identity and private history", async () => {
  const { publishChart, getPublicChart } = await import("./publication"),
    { appendChartVersion } = await import("./service");
  const { requestDeletion, purgeUser } = await import("../services/user-deletion"),
    { createDeletionHandlers } = await import("../storage/deletion");
  const {
    charts,
    chartVersions,
    chartPublications,
    user,
    storageTombstones,
    storageJournalProgress,
  } = await import("../db/schema");
  const { replayJournal } = await import("../../../ops/backup/restore"),
    { Client } = await import("pg");
  const ctx = fixture.ctx,
    id = await readyOwner(ctx),
    a = await chartFile(id),
    b = await chartFile(id);
  let c = await createChart(ctx, id, a.file.id);
  c = await publishChart(ctx, id, c.id, {
    expectedRevision: c.revision,
    versionId: c.currentVersionId,
    confirmOriginalArchive: true,
  });
  c = await appendChartVersion(ctx, id, c.id, { fileId: b.file.id, expectedRevision: c.revision });
  const [oldChart] = await ctx.db.select().from(charts).where(eq(charts.id, c.id)),
    [oldPub] = await ctx.db
      .select()
      .from(chartPublications)
      .where(eq(chartPublications.chartId, c.id)),
    [oldUser] = await ctx.db.select().from(user).where(eq(user.id, id));
  const versions = await ctx.db.select().from(chartVersions).where(eq(chartVersions.chartId, c.id));
  c = await publishChart(ctx, id, c.id, {
    expectedRevision: c.revision,
    versionId: c.currentVersionId,
    confirmOriginalArchive: true,
  });
  const deps = { db: ctx.db, boss: ctx.boss, handlers: createDeletionHandlers(ctx) };
  await requestDeletion(deps, id, { deleteContent: false });
  await ctx.db
    .update(user)
    .set({ deletionPurgeAt: new Date(Date.now() - 1000) })
    .where(eq(user.id, id));
  await purgeUser(deps, id);
  const [head] = await ctx.db.select().from(storageJournalProgress);
  const records = (
    await ctx.db.select().from(storageTombstones).orderBy(storageTombstones.sequence)
  )
    .filter((r) => r.sequence > oldChart.publicationSequence)
    .map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), payload: r.payload ?? undefined }));
  await ctx.db.insert(user).values(oldUser);
  await ctx.db.update(charts).set(oldChart).where(eq(charts.id, c.id));
  for (const v of versions)
    await ctx.db
      .insert(chartVersions)
      .values(v)
      .onConflictDoUpdate({ target: chartVersions.id, set: v });
  for (const f of [a.file, b.file]) await ctx.db.update(files).set(f).where(eq(files.id, f.id));
  await ctx.db.update(chartPublications).set(oldPub).where(eq(chartPublications.chartId, c.id));
  const client = new Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    await replayJournal(client, records, {
      sequence: head.exportedSequence,
      hash: head.chainHash!,
      capturedAt: head.exportedAt!.toISOString(),
    });
  } finally {
    await client.end();
  }
  expect(await getPublicChart(ctx, c.id)).toMatchObject({
    versionId: c.currentVersionId,
    author: null,
  });
  expect(await ctx.db.select().from(user).where(eq(user.id, id))).toHaveLength(0);
  expect(
    (await ctx.db.select().from(chartVersions).where(eq(chartVersions.chartId, c.id))).map(
      (v) => v.id,
    ),
  ).toEqual([c.currentVersionId]);
  expect((await ctx.db.select().from(files).where(eq(files.id, a.file.id)))[0]).toMatchObject({
    ownerId: null,
    state: "deleted",
    originalName: "removed",
  });
});
test("replay with the latest authorized version absent closes access without choosing the old public version", async () => {
  const { publishChart, getPublicChart } = await import("./publication"),
    { appendChartVersion } = await import("./service");
  const { charts, chartVersions, chartPublications, storageTombstones, storageJournalProgress } =
    await import("../db/schema");
  const { replayJournal } = await import("../../../ops/backup/restore"),
    { Client } = await import("pg");
  const ctx = fixture.ctx,
    id = await readyOwner(ctx),
    a = await chartFile(id),
    b = await chartFile(id);
  let c = await createChart(ctx, id, a.file.id);
  c = await publishChart(ctx, id, c.id, {
    expectedRevision: c.revision,
    versionId: c.currentVersionId,
    confirmOriginalArchive: true,
  });
  const oldVersion = c.currentVersionId;
  const [oldChart] = await ctx.db.select().from(charts).where(eq(charts.id, c.id)),
    [oldPub] = await ctx.db
      .select()
      .from(chartPublications)
      .where(eq(chartPublications.chartId, c.id));
  c = await appendChartVersion(ctx, id, c.id, { fileId: b.file.id, expectedRevision: c.revision });
  c = await publishChart(ctx, id, c.id, {
    expectedRevision: c.revision,
    versionId: c.currentVersionId,
    confirmOriginalArchive: true,
  });
  const [latest] = await ctx.db.select().from(charts).where(eq(charts.id, c.id));
  const [fact] = await ctx.db
      .select()
      .from(storageTombstones)
      .where(eq(storageTombstones.sequence, latest.publicationSequence)),
    [head] = await ctx.db.select().from(storageJournalProgress);
  await ctx.db.update(chartPublications).set(oldPub).where(eq(chartPublications.chartId, c.id));
  await ctx.db.update(charts).set(oldChart).where(eq(charts.id, c.id));
  await ctx.db.delete(chartVersions).where(eq(chartVersions.id, c.currentVersionId));
  const diagnostics: unknown[] = [];
  const client = new Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    await replayJournal(
      client,
      [{ ...fact, createdAt: fact.createdAt.toISOString(), payload: fact.payload ?? undefined }],
      {
        sequence: head.exportedSequence,
        hash: head.chainHash!,
        capturedAt: head.exportedAt!.toISOString(),
      },
      { onChartPending: (diagnostic: unknown) => diagnostics.push(diagnostic) },
    );
  } finally {
    await client.end();
  }
  expect(diagnostics).toEqual([
    { code: "CHART_PUBLICATION_RESTORE_PENDING", chartId: c.id, versionId: c.currentVersionId },
  ]);
  await expect(getPublicChart(ctx, c.id)).rejects.toMatchObject({ status: 404 });
  expect((await ctx.db.select().from(charts).where(eq(charts.id, c.id)))[0].currentVersionId).toBe(
    oldVersion,
  );
});
test("whole-chart deletion and final delete-content both revoke durably and remain retryable after exporter failure", async () => {
  const { publishChart, getPublicChart } = await import("./publication"),
    { deleteChart } = await import("./service");
  const { requestDeletion, purgeUser } = await import("../services/user-deletion"),
    { createDeletionHandlers } = await import("../storage/deletion"),
    { user } = await import("../db/schema");
  const ctx = fixture.ctx,
    id = await readyOwner(ctx);
  let c = await createChart(ctx, id, (await chartFile(id)).file.id);
  c = await publishChart(ctx, id, c.id, {
    expectedRevision: c.revision,
    versionId: c.currentVersionId,
    confirmOriginalArchive: true,
  });
  const failed = {
    ...ctx,
    exportChartJournal: async () => {
      throw new Error("offline");
    },
  };
  await expect(deleteChart(failed, id, c.id, c.revision)).rejects.toMatchObject({ status: 503 });
  await expect(getPublicChart(ctx, c.id)).rejects.toMatchObject({ status: 404 });
  await deleteChart(ctx, id, c.id, c.revision);
  let d = await createChart(ctx, id, (await chartFile(id)).file.id);
  d = await publishChart(ctx, id, d.id, {
    expectedRevision: d.revision,
    versionId: d.currentVersionId,
    confirmOriginalArchive: true,
  });
  const deps = { db: ctx.db, boss: ctx.boss, handlers: createDeletionHandlers(failed) };
  await requestDeletion(deps, id, { deleteContent: true });
  await ctx.db
    .update(user)
    .set({ deletionPurgeAt: new Date(Date.now() - 1000) })
    .where(eq(user.id, id));
  await expect(purgeUser(deps, id)).rejects.toMatchObject({ status: 503 });
  await expect(getPublicChart(ctx, d.id)).rejects.toMatchObject({ status: 404 });
  expect(await purgeUser({ ...deps, handlers: createDeletionHandlers(ctx) }, id)).toBe("skipped");
});

test("lost-response read-back cannot report a publication successful before its durable checkpoint", async () => {
  const { publishChart, getPublicChart } = await import("./publication");
  const { getChart } = await import("./service");
  const ctx = fixture.ctx,
    id = await readyOwner(ctx);
  const chart = await createChart(ctx, id, (await chartFile(id)).file.id);
  const input = {
    expectedRevision: chart.revision,
    versionId: chart.currentVersionId,
    confirmOriginalArchive: true,
  };
  const failed = {
    ...ctx,
    exportChartJournal: async () => {
      throw new Error("offline");
    },
  };
  await expect(publishChart(failed, id, chart.id, input)).rejects.toMatchObject({ status: 503 });
  expect(await getChart(ctx, id, chart.id)).toMatchObject({
    publicationPending: true,
    publication: { versionId: chart.currentVersionId },
  });
  await expect(getPublicChart(ctx, chart.id)).rejects.toMatchObject({ status: 404 });
  expect(await publishChart(ctx, id, chart.id, input)).toMatchObject({
    publicationPending: false,
    publication: { versionId: chart.currentVersionId },
  });
});

// A dedicated real PostgreSQL connection pauses a SELECT after its server snapshot,
// while a separate connection commits the conflicting write. No sleeps or product hooks.
async function interleavedChartRead<T>(
  run: (ctx: typeof fixture.ctx) => Promise<T>,
  between: () => Promise<void>,
) {
  const { Client } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const schema = await import("../db/schema");
  const client = new Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  const execute = client.query.bind(client) as (
    config: unknown,
    values?: unknown,
  ) => Promise<unknown>;
  let fired = false;
  client.query = (async (config: string | { text: string }, values?: unknown) => {
    const result = await execute(config, values);
    const text = typeof config === "string" ? config : config.text;
    if (!fired && text.includes('from "charts"') && text.includes('inner join "user"')) {
      fired = true;
      await between();
    }
    return result;
  }) as typeof client.query;
  try {
    const result = await run({
      ...fixture.ctx,
      db: drizzle({ client, schema, casing: "snake_case" }),
    });
    expect(fired).toBe(true);
    return result;
  } finally {
    await client.end();
  }
}
for (const change of ["withdraw", "replace"] as const) {
  test(`GET publication snapshot stays coherent across a failed concurrent ${change}`, async () => {
    const { getChart, appendChartVersion } = await import("./service");
    const { publishChart, withdrawChart } = await import("./publication");
    const ctx = fixture.ctx,
      owner = await readyOwner(ctx);
    let chart = await createChart(ctx, owner, (await chartFile(owner)).file.id);
    chart = await publishChart(ctx, owner, chart.id, {
      expectedRevision: chart.revision,
      versionId: chart.currentVersionId,
      confirmOriginalArchive: true,
    });
    const selected = chart.currentVersionId;
    chart = await appendChartVersion(ctx, owner, chart.id, {
      fileId: (await chartFile(owner)).file.id,
      expectedRevision: chart.revision,
    });
    const failed = {
      ...ctx,
      exportChartJournal: async () => {
        throw new Error("offline");
      },
    };
    const read = await interleavedChartRead(
      (c) => getChart(c, owner, chart.id),
      async () => {
        await expect(
          change === "withdraw"
            ? withdrawChart(failed, owner, chart.id, chart.revision)
            : publishChart(failed, owner, chart.id, {
                expectedRevision: chart.revision,
                versionId: chart.currentVersionId,
                confirmOriginalArchive: true,
              }),
        ).rejects.toMatchObject({ status: 503 });
      },
    );
    expect(read).toMatchObject({
      revision: chart.revision,
      publication: { versionId: selected },
      publicationPending: false,
    });
    expect(await getChart(ctx, owner, chart.id)).toMatchObject({
      revision: chart.revision + 1,
      publicationPending: true,
    });
    await ctx.exportChartJournal!();
  });
}
for (const action of ["publish", "withdraw"] as const) {
  test(`${action} response rereads a coherent snapshot after its barrier and a later pending mutation`, async () => {
    const { getChart } = await import("./service");
    const { publishChart, withdrawChart } = await import("./publication");
    const ctx = fixture.ctx,
      owner = await readyOwner(ctx);
    let chart = await createChart(ctx, owner, (await chartFile(owner)).file.id);
    if (action === "withdraw")
      chart = await publishChart(ctx, owner, chart.id, {
        expectedRevision: chart.revision,
        versionId: chart.currentVersionId,
        confirmOriginalArchive: true,
      });
    const failed = {
      ...ctx,
      exportChartJournal: async () => {
        throw new Error("offline");
      },
    };
    const racing = {
      ...ctx,
      exportChartJournal: async () => {
        await ctx.exportChartJournal!();
        const current = await getChart(ctx, owner, chart.id);
        await expect(
          action === "publish"
            ? withdrawChart(failed, owner, chart.id, current.revision)
            : publishChart(failed, owner, chart.id, {
                expectedRevision: current.revision,
                versionId: current.currentVersionId,
                confirmOriginalArchive: true,
              }),
        ).rejects.toMatchObject({ status: 503 });
      },
    };
    const response =
      action === "publish"
        ? await publishChart(racing, owner, chart.id, {
            expectedRevision: chart.revision,
            versionId: chart.currentVersionId,
            confirmOriginalArchive: true,
          })
        : await withdrawChart(racing, owner, chart.id, chart.revision);
    expect(response).toMatchObject({
      revision: chart.revision + 2,
      publicationPending: true,
      publication: action === "publish" ? null : { versionId: chart.currentVersionId },
    });
    await ctx.exportChartJournal!();
  });
}

for (const missing of ["derivative", "version"] as const) {
  test(`retention replay preserves an anonymous recovery anchor when the authorized ${missing} is missing`, async () => {
    const { publishChart, getPublicChart } = await import("./publication");
    const { appendChartVersion } = await import("./service");
    const { requestDeletion, purgeUser } = await import("../services/user-deletion");
    const { createDeletionHandlers } = await import("../storage/deletion");
    const { retainsFile } = await import("../storage/references");
    const { user, storageTombstones, storageJournalProgress } = await import("../db/schema");
    const { replayJournal } = await import("../../../ops/backup/restore");
    const { Client } = await import("pg");
    const ctx = fixture.ctx,
      owner = await readyOwner(ctx),
      selected = await chartFile(owner),
      secret = await chartFile(owner);
    let chart = await createChart(ctx, owner, selected.file.id);
    const selectedId = chart.currentVersionId;
    chart = await publishChart(ctx, owner, chart.id, {
      expectedRevision: chart.revision,
      versionId: selectedId,
      confirmOriginalArchive: true,
    });
    chart = await appendChartVersion(ctx, owner, chart.id, {
      expectedRevision: chart.revision,
      fileId: secret.file.id,
    });
    const [oldChart] = await ctx.db.select().from(charts).where(eq(charts.id, chart.id));
    const [oldUser] = await ctx.db.select().from(user).where(eq(user.id, owner));
    const versions = await ctx.db
      .select()
      .from(chartVersions)
      .where(eq(chartVersions.chartId, chart.id));
    const deps = { db: ctx.db, boss: ctx.boss, handlers: createDeletionHandlers(ctx) };
    await requestDeletion(deps, owner, { deleteContent: false });
    await ctx.db
      .update(user)
      .set({ deletionPurgeAt: new Date(0) })
      .where(eq(user.id, owner));
    await purgeUser(deps, owner);
    const [head] = await ctx.db.select().from(storageJournalProgress);
    const records = (
      await ctx.db.select().from(storageTombstones).orderBy(storageTombstones.sequence)
    )
      .filter((r) => r.sequence > oldChart.publicationSequence)
      .map((r) => ({
        ...r,
        payload: r.payload ?? undefined,
        createdAt: r.createdAt.toISOString(),
      }));
    await ctx.db.insert(user).values(oldUser);
    await ctx.db.delete(chartPublications).where(eq(chartPublications.chartId, chart.id));
    await ctx.db
      .update(charts)
      .set({ ...oldChart, currentVersionId: null })
      .where(eq(charts.id, chart.id));
    for (const version of versions)
      await ctx.db.insert(chartVersions).values(version).onConflictDoNothing();
    for (const source of [selected, secret])
      await ctx.db.update(files).set(source.file).where(eq(files.id, source.file.id));
    if (missing === "version")
      await ctx.db.delete(chartVersions).where(eq(chartVersions.id, selectedId));
    else
      await ctx.db
        .update(blobDerivatives)
        .set({ state: "pending" })
        .where(eq(blobDerivatives.id, selected.recipe.id));
    const client = new Client({ connectionString: testDatabaseUrl() });
    await client.connect();
    const replay = (diagnostics: unknown[]) =>
      replayJournal(
        client,
        records,
        {
          sequence: head.exportedSequence,
          hash: head.chainHash!,
          capturedAt: head.exportedAt!.toISOString(),
        },
        { onChartPending: (d) => diagnostics.push(d) },
      );
    try {
      const pending: unknown[] = [];
      await replay(pending);
      expect(pending).toEqual([
        { code: "CHART_PUBLICATION_RESTORE_PENDING", chartId: chart.id, versionId: selectedId },
      ]);
      await expect(getPublicChart(ctx, chart.id)).rejects.toMatchObject({ status: 404 });
      expect((await ctx.db.select().from(charts).where(eq(charts.id, chart.id)))[0]).toMatchObject({
        ownerId: null,
        currentVersionId: missing === "version" ? null : selectedId,
      });
      expect(await ctx.db.select().from(user).where(eq(user.id, owner))).toHaveLength(0);
      expect(
        await ctx.db
          .select()
          .from(chartVersions)
          .where(eq(chartVersions.id, chart.currentVersionId)),
      ).toHaveLength(0);
      if (missing === "derivative") {
        expect(await retainsFile(ctx.db, selected.file.id)).toBe(true);
        expect(
          (await ctx.db.select().from(files).where(eq(files.id, selected.file.id)))[0],
        ).toMatchObject({ ownerId: null, state: "ready", originalName: "removed" });
      }
      // A second replay must not delete the already anonymous anchor or its live source.
      await replay([]);
      if (missing === "version") {
        await ctx.db
          .update(files)
          .set({ ...selected.file, ownerId: null, originalName: "removed" })
          .where(eq(files.id, selected.file.id));
        await ctx.db.insert(chartVersions).values(versions.find((v) => v.id === selectedId)!);
      } else
        await ctx.db
          .update(blobDerivatives)
          .set({ state: "ready" })
          .where(eq(blobDerivatives.id, selected.recipe.id));
      const recovered: unknown[] = [];
      await replay(recovered);
      expect(recovered).toEqual([]);
      expect(await getPublicChart(ctx, chart.id)).toMatchObject({
        versionId: selectedId,
        author: null,
      });
      expect(await retainsFile(ctx.db, selected.file.id)).toBe(true);
      expect(
        (await ctx.db.select().from(chartVersions).where(eq(chartVersions.chartId, chart.id))).map(
          (v) => v.id,
        ),
      ).toEqual([selectedId]);
    } finally {
      await client.end();
    }
  });
}

test("invalid permission payload is rejected before it can enter the journal outbox", async () => {
  const { recordPermission } = await import("./publication-journal");
  const { storageTombstones } = await import("../db/schema");
  const chartId = crypto.randomUUID();
  let rejected = false;
  const rollback = new Error("test rollback");
  await fixture.ctx.db
    .transaction(async (tx) => {
      try {
        await recordPermission(
          tx,
          chartId,
          1,
          {
            versionId: crypto.randomUUID(),
            title: "😀".repeat(121),
            artist: "",
            publishedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          new Date(),
        );
      } catch {
        rejected = true;
      }
      expect(
        await tx
          .select()
          .from(storageTombstones)
          .where(sql`${storageTombstones.payload}->>'chartId'=${chartId}`),
      ).toHaveLength(0);
      throw rollback;
    })
    .catch((error) => {
      if (error !== rollback) throw error;
    });
  expect(rejected).toBe(true);
});

test("non-BMP metadata exports at 61 and 120 code points and does not block subsequent withdrawals or retained-user facts", async () => {
  const { publishChart, withdrawChart } = await import("./publication");
  const { updateChart } = await import("./service");
  const { requestDeletion, purgeUser } = await import("../services/user-deletion");
  const { createDeletionHandlers } = await import("../storage/deletion");
  const { user, storageJournalProgress } = await import("../db/schema");
  const ctx = fixture.ctx,
    owner = await readyOwner(ctx),
    other = await readyOwner(ctx);
  let target = await createChart(ctx, other, (await chartFile(other)).file.id);
  target = await publishChart(ctx, other, target.id, {
    expectedRevision: target.revision,
    versionId: target.currentVersionId,
    confirmOriginalArchive: true,
  });
  let chart = await createChart(ctx, owner, (await chartFile(owner)).file.id);
  for (const count of [61, 120]) {
    chart = await updateChart(ctx, owner, chart.id, {
      expectedRevision: chart.revision,
      title: "😀".repeat(count),
      artist: "🎵".repeat(count),
    });
    chart = await publishChart(ctx, owner, chart.id, {
      expectedRevision: chart.revision,
      versionId: chart.currentVersionId,
      confirmOriginalArchive: true,
    });
    expect(chart.publicationPending).toBe(false);
  }
  await expect(
    updateChart(ctx, owner, chart.id, {
      expectedRevision: chart.revision,
      title: "😀".repeat(121),
    }),
  ).rejects.toMatchObject({ status: 400 });
  const [published] = await ctx.db.select().from(storageJournalProgress);
  expect(await withdrawChart(ctx, other, target.id, target.revision)).toMatchObject({
    publication: null,
    publicationPending: false,
  });
  const deps = { db: ctx.db, boss: ctx.boss, handlers: createDeletionHandlers(ctx) };
  await requestDeletion(deps, owner, { deleteContent: false });
  await ctx.db
    .update(user)
    .set({ deletionPurgeAt: new Date(0) })
    .where(eq(user.id, owner));
  expect(await purgeUser(deps, owner)).toBe("purged");
  const [retained] = await ctx.db.select().from(storageJournalProgress);
  expect(retained.exportedSequence).toBeGreaterThan(published.exportedSequence);
});
