import {communityRestoreFixture} from "./community-restore-fixture";
import { expect } from "bun:test";
import { createHash } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";
import type { StorageContext } from "../../src/server/storage/contracts";
import type { ingestFixture } from "../storage/ingest-fixture";
import { charts, chartModerations, chartPublicIds, userPublicIds, storageTombstones, chartVersions, chartPublications, files, user, profiles, uploadSessions } from "../../src/server/db/schema";
import { representationResponse } from "../../src/server/storage/files";
import { initUpload, completeUpload } from "../../src/server/storage/uploads";
import { putUploadPart } from "../../src/server/storage/parts";
import { ingestUpload } from "../../src/media-worker/ingest";
import { handleChartImport } from "../../src/media-worker/chart-import";
import { finalizeUpload } from "../../src/media-worker/finalize";
import { createChart, appendChartVersion, deleteChart, getChart, publicationDto } from "../../src/server/charts/service";
import { publishChart, withdrawChart, getPublicChart, resolvePublicChartDownload, resolvePublicChartAsset } from "../../src/server/charts/publication";
import { createDeletionHandlers } from "../../src/server/storage/deletion";
import { requestDeletion, purgeUser } from "../../src/server/services/user-deletion";
import { testSender } from "../../src/server/testing/test-boss";
import { moderateChart } from "../../src/server/services/dash";
import { exportJournal } from "../../ops/backup/journal";

/** Actual native import and authenticated S3 objects are included in the full PG/restic snapshot. */
export async function publicRestoreFixture(f: Awaited<ReturnType<typeof ingestFixture>>, web: StorageContext, media: StorageContext, control: StorageContext, journal: Parameters<typeof exportJournal>[0]) {
  const source = { ...web, exportChartJournal: async () => { await exportJournal(journal); } };
  const deletion = { ...control, exportChartJournal: source.exportChartJournal };
  const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
  async function upload(owner: string, label: string) {
    const bytes = zipSync({ "maidata.txt": strToU8(`&title=${label}\n&artist=Synthetic public restore\n&inote_4=(120){4}1,2,E\n`) }, { level: 0 });
    const dto = await initUpload(source, owner, { purpose: "chart-source", name: "private-original-name.zip", size: bytes.length, sha256: hash(bytes) }, crypto.randomUUID());
    for (let index = 0; index < dto.partCount; index++) {
      const part = bytes.subarray(index * dto.partSize, (index + 1) * dto.partSize);
      await putUploadPart(source, owner, dto.id, index, part, hash(part));
    }
    await completeUpload(source, owner, dto.id);
    const job = { uploadId: dto.id, generation: 0 };
    await ingestUpload(media, job); await handleChartImport(media, job); await finalizeUpload(media, job);
    const [ready] = await source.db.select().from(uploadSessions).where(eq(uploadSessions.id, dto.id));
    return { id: ready.fileId!, bytes };
  }
  const userNumbers = new Map<string, string>();
  const admin = await f.owner();
  const [adminIdentity] = await source.db.select().from(userPublicIds).where(eq(userPublicIds.userId, admin));
  const actor = { id: admin, publicId: adminIdentity.publicId.toString() };
  userNumbers.set(admin, actor.publicId);
  const rows: { kind: "withdraw" | "replace" | "delete" | "retain" | "legacy" | "moderate" | "moderate-retain"; owner: string; original: Awaited<ReturnType<typeof upload>>; chart: Awaited<ReturnType<typeof createChart>> }[] = [];
  for (const kind of ["withdraw", "replace", "delete", "retain", "legacy", "moderate", "moderate-retain"] as const) {
    const owner = await f.owner(), original = await upload(owner, `Restore ${kind}`);
    const [identity] = await source.db.select().from(userPublicIds).where(eq(userPublicIds.userId, owner));
    userNumbers.set(owner, identity.publicId.toString());
    await source.db.insert(profiles).values({ userId: owner, bio: "private-identity-must-disappear" });
    let chart = await createChart(source, owner, original.id);
    if (kind === "legacy") {
      const now = new Date();
      const publication = { chartId: chart.id, versionId: chart.currentVersionId, title: chart.title, artist: chart.artist, description:"", credits:"", tags:[], releaseNote:"", publishedAt: now, updatedAt: now };
      await source.db.insert(chartPublications).values(publication);
      const [fact] = await source.db.insert(storageTombstones).values({ kind: "chart_permission", payload: { version: 1, chartId: chart.id, revision: 2, publication: publicationDto(publication) } }).returning();
      await source.db.update(charts).set({ revision: 2, publicationSequence: fact.sequence }).where(eq(charts.id, chart.id));
      await source.exportChartJournal();
      chart = await getChart(source, owner, chart.id);
      expect(chart.publicId).toBeNull();
    } else chart = await publishChart(source, owner, chart.id, { expectedRevision: chart.revision, versionId: chart.currentVersionId!, confirmOriginalArchive: true });
    if (kind === "retain") {
      const draft = await upload(owner, "Never public retention draft");
      chart = await appendChartVersion(source, owner, chart.id, { expectedRevision: chart.revision, fileId: draft.id });
    }
    rows.push({ kind, owner, original, chart });
  }
  const community = await communityRestoreFixture(source, f.owner, rows.find(row=>row.kind==="legacy")!.chart);
  let missingVersion = "";
  let lateChart: Awaited<ReturnType<typeof createChart>> | undefined;
  let lateModerated: Awaited<ReturnType<typeof createChart>> | undefined;
  return {
    additionalOriginals: 8,
    communityCases: community.cases,
    async commitLaterFacts() {
      await community.commitLaterFacts();
      for (const row of rows) {
        const { chart, owner, kind } = row;
        if (kind === "withdraw") await withdrawChart(source, owner, chart.id, chart.revision);
        if (kind === "delete") await deleteChart(source, owner, chart.id, chart.revision);
        if (kind === "replace") {
          const next = await upload(owner, "Latest allowed version absent from snapshot");
          const updated = await appendChartVersion(source, owner, chart.id, { expectedRevision: chart.revision, fileId: next.id });
          missingVersion = updated.currentVersionId!;
          await publishChart(source, owner, chart.id, { expectedRevision: updated.revision, versionId: missingVersion, confirmOriginalArchive: true });
        }
        if (kind === "retain" || kind === "moderate-retain") {
          const handlers = createDeletionHandlers(deletion);
          await requestDeletion({ db: source.db, boss: testSender, handlers }, owner, { deleteContent: false });
          // Advance only this synthetic account beyond its seven-day cooling-off boundary.
          await source.db.update(user).set({ deletionPurgeAt: new Date(Date.now() - 1000) }).where(eq(user.id, owner));
          expect(await purgeUser({ db: source.db, handlers }, owner)).toBe("purged");
        }
        if (kind === "moderate" || kind === "moderate-retain") {
          // For moderate-retain this follows a real durable user_deleted retention fact.
          // The old dump still has the original owner's public snapshot in both cases.
          const [current] = await source.db.select().from(charts).where(eq(charts.id, chart.id));
          const moderated = await moderateChart(source, actor, chart.id, { expectedRevision: current.revision, reason: `Restore takedown ${kind}` });
          expect(moderated).toMatchObject({ status: "moderated", pending: false, title: `Restore ${kind}` });
        }
      }
      // This chart and its number do not exist in the old snapshot, but its URL must stay reserved.
      const lateOwner = await f.owner(), lateOriginal = await upload(lateOwner, "Late withdrawn number");
      const [identity] = await source.db.select().from(userPublicIds).where(eq(userPublicIds.userId, lateOwner));
      userNumbers.set(lateOwner, identity.publicId.toString());
      lateChart = await createChart(source, lateOwner, lateOriginal.id);
      lateChart = await publishChart(source, lateOwner, lateChart.id, { expectedRevision: lateChart.revision, versionId: lateChart.currentVersionId, confirmOriginalArchive: true });
      lateChart = await withdrawChart(source, lateOwner, lateChart.id, lateChart.revision);
      // Neither this chart nor its moderation exists in the dump. Recovery must keep
      // the external decision and URL reservation even with no restorable chart/version.
      const moderatedOriginal = await upload(lateOwner, "Late moderated absent chart");
      lateModerated = await createChart(source, lateOwner, moderatedOriginal.id);
      lateModerated = await publishChart(source, lateOwner, lateModerated.id, { expectedRevision: lateModerated.revision, versionId: lateModerated.currentVersionId, confirmOriginalArchive: true });
      await moderateChart(source, actor, lateModerated.id, { expectedRevision: lateModerated.revision, reason: "Restore takedown missing chart" });
      await exportJournal(journal);
    },
    async verify(target: StorageContext) {
      await community.verify(target);
      for (const [owner, number] of userNumbers) {
        const [identity] = await target.db.select().from(userPublicIds).where(eq(userPublicIds.userId, owner));
        expect(identity.publicId.toString()).toBe(number);
      }
      const maximum = [...userNumbers.values()].map(BigInt).reduce((a, b) => a > b ? a : b);
      const sequence = await target.db.execute(sql`select last_value from user_public_ids_public_id_seq`);
      expect(BigInt(String(sequence.rows[0].last_value))).toBeGreaterThanOrEqual(maximum);
      expect(lateChart?.publicId).toMatch(/^[1-9][0-9]*$/);
      const [reserved] = await target.db.select().from(chartPublicIds).where(eq(chartPublicIds.chartId, lateChart!.id));
      expect(reserved.publicId.toString()).toBe(lateChart!.publicId!);
      await expect(getPublicChart(target, lateChart!.publicId!)).rejects.toMatchObject({ status: 404 });
      const missing = lateModerated!;
      const [missingDecision] = await target.db.select().from(chartModerations).where(eq(chartModerations.chartId, missing.id));
      expect(missingDecision).toMatchObject({ publicId: BigInt(missing.publicId!), actorId: admin, actorPublicId: BigInt(actor.publicId), reason: "Restore takedown missing chart", publication: { title: "Late moderated absent chart", versionId: missing.currentVersionId } });
      expect(await target.db.select().from(charts).where(eq(charts.id, missing.id))).toHaveLength(0);
      const [missingIdentity] = await target.db.select().from(chartPublicIds).where(eq(chartPublicIds.chartId, missing.id));
      expect(missingIdentity.publicId.toString()).toBe(missing.publicId!);
      await assertModeratedClosed(missing);
      async function assertModeratedClosed(chart: typeof missing) {
        expect(await target.db.select().from(chartPublications).where(eq(chartPublications.chartId, chart.id))).toHaveLength(0);
        for (const id of [chart.id, chart.publicId!]) {
          await expect(getPublicChart(target, id)).rejects.toMatchObject({ status: 404 });
          await expect(resolvePublicChartDownload(target, id)).rejects.toMatchObject({ status: 404 });
          await expect(resolvePublicChartAsset(target, id, chart.currentVersionId, "maidata")).rejects.toMatchObject({ status: 404 });
        }
      }
      for (const row of rows) {
        if (row.kind === "legacy") {
          const visible = await getPublicChart(target, row.chart.id);
          expect(visible.publicId).toMatch(/^[1-9][0-9]*$/);
          expect(BigInt(visible.publicId)).toBeGreaterThan(BigInt(lateChart!.publicId!));
          expect(await getPublicChart(target, visible.publicId)).toEqual(visible);
          continue;
        }
        const [identity] = await target.db.select().from(chartPublicIds).where(eq(chartPublicIds.chartId, row.chart.id));
        expect(identity.publicId.toString()).toBe(row.chart.publicId!);
        if (row.kind === "moderate" || row.kind === "moderate-retain") {
          const [decision] = await target.db.select().from(chartModerations).where(eq(chartModerations.chartId, row.chart.id));
          expect(decision).toMatchObject({ publicId: BigInt(row.chart.publicId!), actorId: admin, actorPublicId: BigInt(actor.publicId), reason: `Restore takedown ${row.kind}`, revision: row.chart.revision + 1, publication: { title: `Restore ${row.kind}`, versionId: row.chart.publication!.versionId } });
          const [restored] = await target.db.select().from(charts).where(eq(charts.id, row.chart.id));
          expect(restored).toBeDefined();
          expect(restored.revision).toBeGreaterThanOrEqual(decision.revision);
          if (row.kind === "moderate-retain") {
            expect(restored.ownerId).toBeNull();
            expect(await target.db.select().from(user).where(eq(user.id, row.owner))).toHaveLength(0);
            expect(decision.author).toBeNull();
          }
          await assertModeratedClosed(row.chart);
          continue;
        }
        if (row.kind !== "retain") {
          await expect(getPublicChart(target, row.chart.id)).rejects.toMatchObject({ status: 404 });
          await expect(resolvePublicChartDownload(target, row.chart.id)).rejects.toMatchObject({ status: 404 });
          expect(await target.db.select().from(chartPublications).where(eq(chartPublications.chartId, row.chart.id))).toHaveLength(0);
          if (row.kind === "replace") expect(await target.db.select().from(chartVersions).where(eq(chartVersions.id, missingVersion))).toHaveLength(0);
          continue;
        }
        const visible = await getPublicChart(target, row.chart.id);
        expect(visible.author).toBeNull();
        expect(visible.versionId).toBe(row.chart.publication!.versionId);
        expect(await target.db.select().from(user).where(eq(user.id, row.owner))).toHaveLength(0);
        expect(await target.db.select().from(profiles).where(eq(profiles.userId, row.owner))).toHaveLength(0);
        const versions = await target.db.select().from(chartVersions).where(eq(chartVersions.chartId, row.chart.id));
        expect(versions).toHaveLength(1);
        const [file] = await target.db.select().from(files).where(eq(files.id, versions[0].sourceFileId!));
        expect(file.ownerId).toBeNull(); expect(file.originalName).toBe("removed");
        const download = await resolvePublicChartDownload(target, row.chart.id);
        const response = await representationResponse(target, download, new Request("http://127.0.0.1/restored-chart/download"), AbortSignal.timeout(10000));
        expect(response.status).toBe(200);
        expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(row.original.bytes));
      }
    },
    async cleanup() {
      const ids = [...rows.map(row => row.chart.id), ...(lateChart ? [lateChart.id] : []), ...(lateModerated ? [lateModerated.id] : [])];
      await source.db.delete(chartModerations).where(inArray(chartModerations.chartId, ids));
      await source.db.delete(chartPublications).where(inArray(chartPublications.chartId, ids));
      await source.db.update(charts).set({ currentVersionId: null }).where(inArray(charts.id, ids));
      await source.db.delete(chartVersions).where(inArray(chartVersions.chartId, ids));
      await source.db.delete(charts).where(inArray(charts.id, ids));
    },
  };
}
