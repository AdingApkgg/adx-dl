import { beforeAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import {
	resetTestDatabase,
	testDbHandle,
} from "../../src/server/testing/test-db";
import { readyContext, readyOwner, readyFile } from "./ready-file";
import {
	blobs,
	files,
	storageUsage,
	storageBudget,
	storageTombstones,
	user,
	userAvatars,
	mediaPublications,
	storageQuarantine,
} from "../../src/server/db/schema";
import { deleteFile, getFile } from "../../src/server/storage/files";
import { setAvatar } from "../../src/server/storage/avatars";
import { createStorageDeletionHandler } from "../../src/server/storage/deletion";
import {
	requestDeletion,
	cancelDeletion,
} from "../../src/server/services/user-deletion";
import {
	initializeJournal,
	exportJournal,
	verifyLatestJournal,
} from "../../ops/backup/journal";
import { replayJournal } from "../../ops/backup/restore";
import {
	acquireStorageMaintenance,
	releaseStorageMaintenance,
} from "../../src/server/storage/maintenance";
import { deleteStorageObject } from "../../src/worker/storage-delete";
import { cleanupStorageQuarantine } from "../../src/worker/storage-reconcile";
import { assertStorageDrained } from "../../ops/backup/export";
let fixture: Awaited<ReturnType<typeof readyContext>>;
beforeAll(async () => {
	await resetTestDatabase();
	fixture = await readyContext();
	await fixture.ctx.boss();
}, 30000);
async function journalReplay(
	run: (
		c: Client,
		config: Parameters<typeof initializeJournal>[0],
	) => Promise<void>,
) {
	const dir = await mkdtemp(join(tmpdir(), "final-review-journal-"));
	const config = {
		directory: join(dir, "journal"),
		keyFile: join(dir, "key"),
		databaseUrl: process.env.TEST_DATABASE_URL!,
	};
	await writeFile(config.keyFile, crypto.getRandomValues(new Uint8Array(32)), {
		mode: 0o600,
	});
	await testDbHandle().pool.query(
		"update storage_journal_progress set exported_sequence=0,chain_hash=null,exported_at=null where id='global'",
	);
	await initializeJournal(config);
	const c = new Client({ connectionString: config.databaseUrl });
	await c.connect();
	try {
		await run(c, config);
	} finally {
		await c.end();
		await rm(dir, { recursive: true, force: true });
	}
}
test("I1 explicit private delete journals once and replay preserves another file sharing the blob", async () => {
	const { ctx, policy } = fixture,
		id = await readyOwner(ctx),
		a = await readyFile(ctx, policy.id, id);
	const [shared] = await ctx.db
		.insert(files)
		.values({
			ownerId: id,
			blobId: a.blob.id,
			originalName: "shared.png",
			purpose: "avatar",
			size: a.file.size,
			state: "ready",
		})
		.returning();
	await ctx.db
		.update(storageUsage)
		.set({ usedBytes: 2 * a.file.size })
		.where(eq(storageUsage.userId, id));
	await journalReplay(async (c, config) => {
		await deleteFile(ctx, id, a.file.id);
		await deleteFile(ctx, id, a.file.id);
		const facts = await ctx.db
			.select()
			.from(storageTombstones)
			.where(eq(storageTombstones.fileId, a.file.id));
		expect(facts.filter((r) => r.kind === "file_deleted")).toHaveLength(1);
		expect(
			(
				await ctx.db
					.select()
					.from(storageUsage)
					.where(eq(storageUsage.userId, id))
			)[0].usedBytes,
		).toBe(a.file.size);
		await exportJournal(config);
		const verified = await verifyLatestJournal(config);
		await ctx.db
			.update(files)
			.set({ state: "ready", deletedAt: null })
			.where(eq(files.id, a.file.id));
		await replayJournal(c, verified.records, verified.head);
		await expect(getFile(ctx, id, a.file.id)).rejects.toMatchObject({
			status: 404,
		});
		expect(
			(await ctx.db.select().from(files).where(eq(files.id, shared.id)))[0]
				.state,
		).toBe("ready");
		expect(
			(await ctx.db.select().from(blobs).where(eq(blobs.id, a.blob.id)))[0]
				.state,
		).toBe("ready");
	});
});
test("I4 shared cooling-off withdrawal replays individually and cancellation advances the revision", async () => {
	const { ctx, policy } = fixture,
		aId = await readyOwner(ctx),
		bId = await readyOwner(ctx);
	const a = await readyFile(ctx, policy.id, aId),
		b = await readyFile(ctx, policy.id, bId, a.derived);
	for (const [id, f] of [
		[aId, a],
		[bId, b],
	] as const)
		await setAvatar(
			ctx,
			id,
			{ fileId: f.file.id, expectedRevision: 0 },
			crypto.randomUUID(),
		);
	const handlers = [
		createStorageDeletionHandler(ctx),
		{
			name: "retained-content",
			hasContent: async () => true,
			purge: async () => {},
		},
	];
	await journalReplay(async (c, config) => {
		await requestDeletion({ db: ctx.db, boss: ctx.boss, handlers }, aId, {
			deleteContent: true,
		});
		const facts = await ctx.db
			.select()
			.from(storageTombstones)
			.where(eq(storageTombstones.sha256, a.derived.outputSha256));
		expect(facts.map((r) => [r.userId, r.fileId, r.generation])).toEqual([
			[aId, a.file.id, 2],
		]);
		await exportJournal(config);
		const verified = await verifyLatestJournal(config);
		await cancelDeletion({ db: ctx.db, boss: ctx.boss, handlers }, aId);
		expect(
			(
				await ctx.db
					.select()
					.from(userAvatars)
					.where(eq(userAvatars.userId, aId))
			)[0].revision,
		).toBe(3);
		await replayJournal(c, verified.records, verified.head);
		expect(
			(
				await ctx.db
					.select()
					.from(userAvatars)
					.where(eq(userAvatars.userId, aId))
			)[0].fileId,
		).toBe(a.file.id);
		await ctx.db
			.update(userAvatars)
			.set({ revision: 1 })
			.where(eq(userAvatars.userId, aId));
		await replayJournal(c, verified.records, verified.head);
		expect(
			(
				await ctx.db
					.select()
					.from(userAvatars)
					.where(eq(userAvatars.userId, aId))
			)[0].fileId,
		).toBeNull();
		expect(
			(await ctx.db.select().from(user).where(eq(user.id, aId)))[0].image,
		).toBeNull();
		expect(
			(
				await ctx.db
					.select()
					.from(userAvatars)
					.where(eq(userAvatars.userId, bId))
			)[0].fileId,
		).toBe(b.file.id);
		expect(
			(
				await ctx.db
					.select()
					.from(mediaPublications)
					.where(eq(mediaPublications.outputSha256, a.derived.outputSha256))
			)[0].state,
		).toBe("public");
	});
});
for (const kind of ["canonical", "quarantine"] as const)
	for (const outcome of ["success", "stale", "failure"] as const)
		test(`I2 admitted ${kind} ${outcome} DELETE settlement while maintenance is closed`, async () => {
			const { ctx, policy } = fixture;
			const hash = crypto.randomUUID().replaceAll("-", "").repeat(2),
				key = `sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`;
			const size = 7,
				now = new Date();
			const [row] =
				kind === "canonical"
					? await ctx.db
							.insert(blobs)
							.values({
								policyId: policy.id,
								sha256: hash,
								key,
								size,
								state: "deleting",
								generation: 2,
								properties: {
									deletion: {
										generation: 2,
										chargedFrom: "written",
										startedAt: null,
										uncertain: false,
									},
								},
							})
							.returning()
					: await ctx.db
							.insert(storageQuarantine)
							.values({
								policyId: policy.id,
								sha256: hash,
								key,
								size,
								observedEtag: "v1",
								state: "quarantined",
								lastObservedAt: new Date(now.getTime() - 3 * 86400000),
							})
							.returning();
			const before = (await ctx.db.select().from(storageBudget))[0]
				.originalWritten;
			await ctx.db
				.update(storageBudget)
				.set({ originalWritten: before + size });
			let start!: () => void, release!: () => void;
			const started = new Promise<void>((r) => (start = r)),
				paused = new Promise<void>((r) => (release = r));
			let calls = 0;
			const scoped = {
				...ctx,
				driver: {
					...ctx.driver,
					head: async () => ({
						size,
						mime: "image/png",
						sha256: hash,
						etag: "v1",
					}),
					delete: async () => {
						calls++;
						start();
						await paused;
						if (outcome === "failure") throw new Error("remote DELETE failed");
					},
				},
			};
			const work =
				kind === "canonical"
					? deleteStorageObject(scoped, {
							kind: "blob",
							id: row.id,
							generation: 2,
						})
					: cleanupStorageQuarantine(scoped);
			const observed = work.then(
				() => null,
				(e) => e,
			);
			let lease:
				| Awaited<ReturnType<typeof acquireStorageMaintenance>>
				| undefined;
			try {
				await started;
				lease = await acquireStorageMaintenance(ctx.db);
				if (outcome === "stale") {
					if (kind === "canonical")
						await ctx.db
							.update(blobs)
							.set({
								generation: 3,
								properties: {
									deletion: {
										generation: 3,
										chargedFrom: "written",
										startedAt: new Date().toISOString(),
										uncertain: false,
									},
								},
							})
							.where(eq(blobs.id, row.id));
					else
						await ctx.db
							.update(storageQuarantine)
							.set({ generation: 9, deleteStartedAt: new Date() })
							.where(eq(storageQuarantine.id, row.id));
				}
				release();
				const error = await observed;
				if (outcome !== "failure") expect(error).toBeNull();
				const state =
					kind === "canonical"
						? (await ctx.db.select().from(blobs).where(eq(blobs.id, row.id)))[0]
								.state
						: (
								await ctx.db
									.select()
									.from(storageQuarantine)
									.where(eq(storageQuarantine.id, row.id))
							)[0].state;
				expect(state).toBe(outcome === "success" ? "deleted" : "deleting");
				expect(
					(await ctx.db.select().from(storageBudget))[0].originalWritten,
				).toBe(outcome === "success" ? before : before + size);
				if (outcome === "success")
					await assertStorageDrained(testDbHandle().pool);
				else
					await expect(
						assertStorageDrained(testDbHandle().pool),
					).rejects.toThrow("STORAGE_IO_UNCERTAIN");
				expect(calls).toBe(1);
				await releaseStorageMaintenance(ctx.db, lease);
				lease = undefined;
				if (kind === "canonical")
					await deleteStorageObject(scoped, {
						kind: "blob",
						id: row.id,
						generation: 2,
					}).catch(() => {});
				else await cleanupStorageQuarantine(scoped);
				expect(calls).toBe(1);
				expect(
					(await ctx.db.select().from(storageBudget))[0].originalWritten,
				).toBe(outcome === "success" ? before : before + size);
			} finally {
				release();
				await observed;
				if (lease) await releaseStorageMaintenance(ctx.db, lease);
				if (kind === "canonical")
					await ctx.db.delete(blobs).where(eq(blobs.id, row.id));
				else
					await ctx.db
						.delete(storageQuarantine)
						.where(eq(storageQuarantine.id, row.id));
				await ctx.db.update(storageBudget).set({ originalWritten: before });
			}
		});
