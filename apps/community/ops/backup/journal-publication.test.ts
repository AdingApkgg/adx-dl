import { beforeAll, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	resetTestDatabase,
	testDbHandle,
} from "../../src/server/testing/test-db";
import {
	initializeJournal,
	exportJournal,
	retainJournal,
	verifyLatestJournal,
} from "./journal";
beforeAll(resetTestDatabase, 30000);
for (const mode of ["head", "retention"] as const)
	test(`I3 late ${mode} rename keeps durable ownership across timeout and cannot be overtaken`, async () => {
		const dir = await fs.mkdtemp(join(tmpdir(), "journal-owner-"));
		const config = {
			directory: join(dir, "journal"),
			keyFile: join(dir, "key"),
			databaseUrl: process.env.TEST_DATABASE_URL!,
		};
		await fs.writeFile(
			config.keyFile,
			crypto.getRandomValues(new Uint8Array(32)),
			{ mode: 0o600 },
		);
		const { pool } = testDbHandle();
		await pool.query(
			"update storage_journal_progress set exported_sequence=0,chain_hash=null,exported_at=null where id='global'",
		);
		await initializeJournal(config);
		await pool.query(
			"insert into storage_tombstones(kind,user_id) values('user_deleted','first')",
		);
		if (mode === "retention") await exportJournal(config);
		const marker = join(config.directory, ".publisher.lock");
		let started!: () => void, release!: () => void, finished!: () => void;
		const pending = new Promise<void>((r) => (started = r)),
			paused = new Promise<void>((r) => (release = r)),
			settled = new Promise<void>((r) => (finished = r));
		const realRename = fs.rename;
		let intercepted = false;
		const rename = spyOn(fs, "rename").mockImplementation(async (from, to) => {
			if (
				!intercepted &&
				String(to) ===
					join(config.directory, mode === "head" ? "head.json" : "anchor.json")
			) {
				intercepted = true;
				started();
				await paused;
				try {
					await realRename(from, to);
				} finally {
					finished();
				}
				return;
			}
			return realRename(from, to);
		});
		const controller = new AbortController();
		let work: Promise<unknown> | undefined;
		try {
			const future = new Date();
			future.setUTCMonth(future.getUTCMonth() + 8);
			work =
				mode === "head"
					? exportJournal(config, controller.signal)
					: retainJournal(config, future, controller.signal);
			const observed = work.then(
				() => null,
				(e) => e,
			);
			await pending;
			controller.abort();
			expect((await observed)?.message).toBe("STORAGE_JOURNAL_DEADLINE");
			await pool.query(
				"insert into storage_tombstones(kind,user_id) values('user_deleted','later')",
			);
			await expect(exportJournal(config)).rejects.toThrow();
			await expect(verifyLatestJournal(config)).rejects.toThrow();
			const owner = JSON.parse(await fs.readFile(marker, "utf8"));
			expect(owner.owner).toMatch(/^[a-f0-9-]{36}$/);
			release();
			await settled;
			await Bun.sleep(50);
			// Failed publication stays fenced even after its FS callback settles, until controlled recovery.
			expect(JSON.parse(await fs.readFile(marker, "utf8")).owner).toBe(
				owner.owner,
			);
			await expect(verifyLatestJournal(config)).rejects.toThrow();
			// Test-only simulation of an operator-confirmed reaped publisher, all callers stopped.
			await fs.rename(marker, `${marker}.reaped`);
			rename.mockRestore();
			await exportJournal(config);
			const verified = await verifyLatestJournal(config);
			expect(verified.records.some((r) => r.userId === "later")).toBe(true);
		} finally {
			release();
			if (intercepted) await settled;
			await work?.catch(() => {});
			rename.mockRestore();
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

test("I3 successful publisher cannot remove a replacement owner nonce", async () => {
	const dir = await fs.mkdtemp(join(tmpdir(), "journal-owner-change-"));
	const config = {
		directory: join(dir, "journal"),
		keyFile: join(dir, "key"),
		databaseUrl: process.env.TEST_DATABASE_URL!,
	};
	await fs.writeFile(
		config.keyFile,
		crypto.getRandomValues(new Uint8Array(32)),
		{ mode: 0o600 },
	);
	await testDbHandle().pool.query(
		"update storage_journal_progress set exported_sequence=0,chain_hash=null,exported_at=null where id='global'",
	);
	await initializeJournal(config);
	await testDbHandle().pool.query(
		"insert into storage_tombstones(kind,user_id) values('user_deleted','owner-change')",
	);
	const marker = join(config.directory, ".publisher.lock"),
		replacement = crypto.randomUUID(),
		realRename = fs.rename;
	const rename = spyOn(fs, "rename").mockImplementation(async (from, to) => {
		if (String(to) === join(config.directory, "head.json"))
			await fs.writeFile(marker, JSON.stringify({ owner: replacement }));
		return realRename(from, to);
	});
	try {
		await expect(exportJournal(config)).rejects.toThrow(
			"STORAGE_JOURNAL_PUBLISHER_CHANGED",
		);
		expect(JSON.parse(await fs.readFile(marker, "utf8")).owner).toBe(
			replacement,
		);
		await expect(verifyLatestJournal(config)).rejects.toThrow();
	} finally {
		rename.mockRestore();
		await fs.rm(dir, { recursive: true, force: true });
	}
});
