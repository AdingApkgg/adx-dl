import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { eq, sql } from "drizzle-orm";
import { initializeJournal, exportJournal } from "../../../ops/backup/journal";
import { replayCommunityContent, finishCommunityReplay } from "../../../ops/backup/community-replay";
import { Client } from "pg";
import { readyContext, readyOwner } from "../../../test/storage/ready-file";
import { cleanupStorageFixture } from "../../../test/storage/fixture";
import { resetTestDatabase } from "../testing/test-db";
import { testDatabaseUrl } from "../testing/services";
import { prepareTestQueues } from "../testing/test-boss";
import { communityContentStates, communityNotices, storageJournalProgress } from "../db/schema";
import { createTopic, createForumReply, editTopic, getTopic, listBoards, listTopics, removeTopic, setSubscription } from "./forum";
import { dispatchDiscussionOutbox, listNotifications, readNotifications } from "./notifications";
import { moderate, createReport, listReports, resolveReport, updateBoard } from "./moderation";
import { getNotice, listNotices, saveNotice } from "../community/site";
import { purgeDiscussionUser } from "./deletion";
import { withStorageTransaction } from "../storage/transactions";
import type { NoticeDraft } from "@/shared/community-site";
let fixture: Awaited<ReturnType<typeof readyContext>>;
const owners: string[] = [];
async function owner() { const id = await readyOwner(fixture.ctx); owners.push(id); return id; }
const key = () => crypto.randomUUID();
const input = () => ({ idempotencyKey: key(), boardId: "general", title: `Topic ${key()}`, body: "Public **text**\n<script>escaped</script>", chartIds: [] });
async function cool(id: string) { await fixture.ctx.db.execute(sql`update discussion_requests set created_at=clock_timestamp()-interval '11 seconds' where user_id=${id}`); }
beforeAll(async () => {
  await resetTestDatabase(); await prepareTestQueues(); fixture = await readyContext();
  const directory = await mkdtemp("/tmp/community-platform-journal-");
  const keyFile = `${directory}/key`; await writeFile(keyFile, crypto.getRandomValues(new Uint8Array(32)), { mode: 0o600 });
  const journal = { directory: `${directory}/log`, keyFile, databaseUrl: testDatabaseUrl() };
  await fixture.ctx.db.update(storageJournalProgress).set({ exportedSequence: 0, chainHash: null, exportedAt: null }).where(eq(storageJournalProgress.id, "global"));
  await initializeJournal(journal); fixture.ctx.exportChartJournal = async () => { await exportJournal(journal); };
}, 30000);
afterAll(async () => { if (fixture) await cleanupStorageFixture(fixture.ctx.db, owners, [fixture.policy.id]); }, 30000);

test("forum IDs, uncertain creation and current body revisions remain independent of controls", async () => {
  const a = await owner(), draft = input(), t = await createTopic(fixture.ctx, a, draft);
  expect(t.publicId).toMatch(/^[1-9]\d*$/); expect(t.body).toBe(draft.body);
  expect((await createTopic(fixture.ctx, a, draft)).id).toBe(t.id);
  await expect(createTopic(fixture.ctx, a, { ...draft, body: "different" })).rejects.toMatchObject({ status: 409 });
  const edited = await editTopic(fixture.ctx, a, t.publicId, { expectedRevision: t.revision, title: draft.title, body: "New body", chartIds: [] });
  await expect(editTopic(fixture.ctx, a, t.publicId, { expectedRevision: t.revision, title: draft.title, body: "stale", chartIds: [] })).rejects.toMatchObject({ status: 409 });
  await moderate(fixture.ctx, a, { topic: t.publicId }, { expectedRevision: edited.controlRevision, action: "lock", reason: "Internal", publicReason: "Read only" });
  expect((await getTopic(fixture.ctx, t.publicId)).topic.body).toBe("New body");
  await expect(createForumReply(fixture.ctx, await owner(), t.publicId, { idempotencyKey: key(), body: "blocked" })).rejects.toMatchObject({ status: 409 });
  await moderate(fixture.ctx, a, { topic: t.publicId }, { expectedRevision: edited.revision, action: "hide", reason: "Internal", publicReason: "Hidden" });
  await expect(getTopic(fixture.ctx, t.publicId)).rejects.toMatchObject({ status: 404 });
  const replay = await createTopic(fixture.ctx, a, draft);
  expect(replay).toMatchObject({ id: t.id, publicId: t.publicId, title: null, body: null, author: null });
});

test("subscriptions aggregate, direct replies win and repeated dispatch does not duplicate", async () => {
  const a = await owner(), b = await owner(), c = await owner(), t = await createTopic(fixture.ctx, a, input());
  await setSubscription(fixture.ctx, b, t.publicId, true);
  const first = await createForumReply(fixture.ctx, c, t.publicId, { idempotencyKey: key(), body: "First" });
  await dispatchDiscussionOutbox(fixture.ctx);
  expect((await listNotifications(fixture.ctx, b, {})).items).toHaveLength(1);
  await cool(c);
  const second = await createForumReply(fixture.ctx, c, t.publicId, { idempotencyKey: key(), body: "Second" });
  await dispatchDiscussionOutbox(fixture.ctx);
  const grouped = await listNotifications(fixture.ctx, b, {});
  expect(grouped.items).toHaveLength(1); expect(grouped.items[0]?.message?.id).toBe(second.id);
  await readNotifications(fixture.ctx, b, grouped.items.map(x => x.id));
  await cool(a);
  await createForumReply(fixture.ctx, a, t.publicId, { idempotencyKey: key(), body: "Direct", replyToId: first.id });
  await dispatchDiscussionOutbox(fixture.ctx); await dispatchDiscussionOutbox(fixture.ctx);
  const direct = await listNotifications(fixture.ctx, c, {});
  expect(direct.items).toHaveLength(1); expect(direct.items[0]?.kind).toBe("direct_reply");
  expect((await listNotifications(fixture.ctx, b, { unread: true })).items).toHaveLength(1);
});

test("withdrawn roots retain lawful replies, leave discovery, and can be wholly hidden", async () => {
  const a = await owner(), b = await owner(), draft = input(), t = await createTopic(fixture.ctx, a, draft);
  const reply = await createForumReply(fixture.ctx, b, t.publicId, { idempotencyKey: key(), body: "Lawful reply" });
  await removeTopic(fixture.ctx, a, t.publicId, t.revision);
  const removed = await getTopic(fixture.ctx, t.publicId);
  expect(removed.topic).toMatchObject({ state: "root_removed", body: null, title: null, locked: true });
  expect(removed.replies.items.map(x => x.id)).toEqual([reply.id]);
  expect((await listTopics(fixture.ctx, { q: draft.title })).items).toHaveLength(0);
  await moderate(fixture.ctx, b, { topic: t.publicId }, { expectedRevision: removed.topic.revision, action: "hide", reason: "Whole topic", publicReason: "Hidden" });
  await expect(getTopic(fixture.ctx, t.publicId)).rejects.toMatchObject({ status: 404 });
  expect((await createTopic(fixture.ctx, a, draft)).body).toBeNull();
});

test("reports require exact moderation before actioned closure and evidence expires without extension", async () => {
  const a = await owner(), b = await owner(), t = await createTopic(fixture.ctx, a, input());
  const r = await createReport(fixture.ctx, b, { targetType: "forum_topic", targetId: t.id, category: "other", details: "Please review" });
  await expect(resolveReport(fixture.ctx, b, r.id, { status: "actioned", note: "Done" })).rejects.toMatchObject({ status: 409 });
  expect((await listReports(fixture.ctx, {})).items.find(x => x.id === r.id)?.evidence?.body).toBe(t.body!);
  await moderate(fixture.ctx, b, { topic: t.publicId }, { expectedRevision: t.revision, action: "hide", reason: "Internal", publicReason: "Public" });
  await resolveReport(fixture.ctx, b, r.id, { status: "actioned", note: "Done" });
  await fixture.ctx.db.execute(sql`update discussion_reports set evidence_expires_at=clock_timestamp()-interval '1 second' where id=${r.id}::uuid`);
  expect((await listReports(fixture.ctx, { status: "all" })).items.find(x => x.id === r.id)?.evidence).toBeNull();
  await resolveReport(fixture.ctx, b, r.id, { status: "dismissed", note: "Cannot replace" });
  expect((await listReports(fixture.ctx, {}, b)).items.find(x => x.id === r.id)?.resolutionNote).toBe("Done");
  await withStorageTransaction(fixture.ctx.db, tx => purgeDiscussionUser(tx, a));
  const rows = await fixture.ctx.db.execute(sql`select evidence_body,target_author_id from discussion_reports where id=${r.id}::uuid`);
  expect(rows.rows[0]).toMatchObject({ evidence_body: null, target_author_id: null });
});

const notice = (body = "Public notice"): NoticeDraft => ({ title: { zh: "公告", en: "Notice" }, body: { zh: body }, level: "important", order: 1, href: "/help", linkLabel: { zh: "帮助" }, startsAt: null, expiresAt: null });
test("notice snapshots isolate drafts, replay publication, and retain terminal withdrawal after old backup", async () => {
  const a = await owner(), id = key(), first = await saveNotice(fixture.ctx, a, id, { expectedRevision: 0, action: "save", draft: notice() });
  const published = await saveNotice(fixture.ctx, a, id, { expectedRevision: first.revision, action: "publish" });
  expect((await saveNotice(fixture.ctx, a, id, { expectedRevision: first.revision, action: "publish" })).revision).toBe(published.revision);
  const edited = await saveNotice(fixture.ctx, a, id, { expectedRevision: published.revision, action: "save", draft: notice("Private edit") });
  expect((await listNotices(fixture.ctx)).items.find(x => x.id === id)?.publication?.body.zh).toBe("Public notice");
  const terminal = await saveNotice(fixture.ctx, a, id, { expectedRevision: edited.revision, action: "withdraw" });
  await fixture.ctx.db.update(communityNotices).set({ revision: first.revision, withdrawn: false, publication: published.publication, publicationHash: (await fixture.ctx.db.select().from(communityContentStates).where(eq(communityContentStates.key, `notice:${id}`)))[0]?.fact.hash ?? null }).where(eq(communityNotices.id, id));
  expect(await getNotice(fixture.ctx, id)).toMatchObject({ revision: terminal.revision, withdrawn: true, publication: null });
  expect((await listNotices(fixture.ctx)).items.some(x => x.id === id)).toBe(false);
  await expect(saveNotice(fixture.ctx, a, id, { expectedRevision: terminal.revision, action: "publish" })).rejects.toMatchObject({ status: 409 });
  await saveNotice(fixture.ctx, a, id, { expectedRevision: first.revision, action: "withdraw" });
});

test("missing latest notice body requires explicit new publication above the durable revision", async () => {
  const a = await owner(), id = key();
  let current = await saveNotice(fixture.ctx, a, id, { expectedRevision: 0, action: "save", draft: notice("First") });
  current = await saveNotice(fixture.ctx, a, id, { expectedRevision: current.revision, action: "publish" });
  const [old] = await fixture.ctx.db.select().from(communityNotices).where(eq(communityNotices.id, id));
  current = await saveNotice(fixture.ctx, a, id, { expectedRevision: current.revision, action: "save", draft: notice("Newer") });
  current = await saveNotice(fixture.ctx, a, id, { expectedRevision: current.revision, action: "publish" });
  await fixture.ctx.db.update(communityNotices).set({ revision: old.revision, draft: old.draft, publication: old.publication, publicationHash: old.publicationHash }).where(eq(communityNotices.id, id));
  expect((await listNotices(fixture.ctx)).items.some(x => x.id === id)).toBe(false);
  expect(await getNotice(fixture.ctx, id)).toMatchObject({ revision: current.revision, publicationPending: true });
  const saved = await saveNotice(fixture.ctx, a, id, { expectedRevision: current.revision, action: "save", draft: notice("Explicit replacement") });
  const replacement = await saveNotice(fixture.ctx, a, id, { expectedRevision: saved.revision, action: "publish" });
  expect(replacement.revision).toBeGreaterThan(current.revision);
  expect((await listNotices(fixture.ctx)).items.find(x => x.id === id)?.publication?.body.zh).toBe("Explicit replacement");
});

test("recovery reserves numeric IDs and suppresses historical outbox redelivery", async () => {
  const c = new Client({ connectionString: testDatabaseUrl() }); await c.connect();
  const id = key(), publicId = "8000000000000000000";
  try {
    await c.query("begin");
    const fact = { version: 1 as const, entity: "forum_id" as const, id, revision: 1, state: "allocated" as const, publicId };
    const record = { sequence: 1, kind: "community_content" as const, userId: null, fileId: null, sha256: null, generation: null, createdAt: new Date().toISOString(), payload: fact };
    await replayCommunityContent(c, record);
    await finishCommunityReplay(c, Number.MAX_SAFE_INTEGER);
    expect((await c.query("select public_id::text from forum_public_ids where topic_id=$1", [id])).rows[0]?.public_id).toBe(publicId);
    expect((await c.query("select count(*)::int n from discussion_outbox where not completed")).rows[0]?.n).toBe(0);
  } finally { await c.query("rollback"); await c.end(); }
  // PostgreSQL identity sequences are not transactional: reset only this isolated test sequence.
  await fixture.ctx.db.execute(sql`select setval('forum_public_ids_public_id_seq',coalesce(max(public_id),1),count(*)>0) from forum_public_ids`);
});

test("board readonly controls survive independently of title/body and reject new writes", async () => {
  const a = await owner(), b = await owner(), board = (await listBoards(fixture.ctx)).items.find(x => x.id === "general")!;
  await updateBoard(fixture.ctx, a, board.id, { expectedRevision: board.revision, name: board.name, description: board.description, order: board.order, readOnly: true, reason: "Read only" });
  try {
    expect((await listBoards(fixture.ctx)).items.find(x => x.id === board.id)?.readOnly).toBe(true);
    await expect(createTopic(fixture.ctx, b, input())).rejects.toMatchObject({ status: 409 });
    await expect(updateBoard(fixture.ctx, a, board.id, { expectedRevision: board.revision, name: board.name, description: board.description, order: board.order, readOnly: false, reason: "Stale" })).rejects.toMatchObject({ status: 409 });
  } finally {
    const latest = (await listBoards(fixture.ctx)).items.find(x => x.id === board.id)!;
    await updateBoard(fixture.ctx, a, board.id, { expectedRevision: latest.revision, name: board.name, description: board.description, order: board.order, readOnly: false, reason: "Reopen fixture" });
  }
});
