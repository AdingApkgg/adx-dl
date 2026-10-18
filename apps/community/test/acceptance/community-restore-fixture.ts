import { expect } from "bun:test";
import { eq, sql } from "drizzle-orm";
import type { StorageContext } from "../../src/server/storage/contracts";
import type { NoticeDraft } from "../../src/shared/community-site";
import { user, forumPublicIds } from "../../src/server/db/schema";
import { createTopic, createForumReply, editTopic, getTopic, listTopics, removeTopic } from "../../src/server/discussions/forum";
import { createChartMessage, listChartDiscussion } from "../../src/server/discussions/messages";
import { createReport, listReports, moderate } from "../../src/server/discussions/moderation";
import { getNotice, listNotices, saveNotice } from "../../src/server/community/site";
import { createDeletionHandlers } from "../../src/server/storage/deletion";
import { requestDeletion, purgeUser } from "../../src/server/services/user-deletion";
import { testSender } from "../../src/server/testing/test-boss";

/** Old real database dump + newer no-body journal, verified after fresh-volume recovery. */
export async function communityRestoreFixture(ctx: StorageContext, owner: () => Promise<string>, chart: { id: string; currentVersionId: string }) {
  const a = await owner(), b = await owner(), doomed = await owner();
  const key = () => crypto.randomUUID();
  const cool = (id: string) => ctx.db.execute(sql`update discussion_requests set created_at=clock_timestamp()-interval '11 seconds' where user_id=${id}`);
  async function topic(label: string, author = a) { await cool(author); return createTopic(ctx, author, { idempotencyKey: key(), boardId: "general", title: label, body: `${label} before snapshot`, chartIds: [] }); }
  const removed = await topic("Root removed"), hidden = await topic("Whole topic hidden"), edited = await topic("Missing latest body"), purged = await topic("Deleted account", doomed);
  const replies: Record<string, string> = {};
  for (const t of [removed, hidden, edited, purged]) { await cool(b); replies[t.id] = (await createForumReply(ctx, b, t.publicId, { idempotencyKey: key(), body: `Lawful ${t.id}` })).id; }
  await cool(b);
  const comment = await createChartMessage(ctx, b, chart.id, { idempotencyKey: key(), versionId: chart.currentVersionId, body: "Hidden comment before snapshot" });
  const report = await createReport(ctx, a, { targetType: "forum_topic", targetId: purged.id, category: "other", details: "Private report on doomed author" });
  const draft = (body: string): NoticeDraft => ({ title: { zh: "恢复验收公告" }, body: { zh: body }, level: "normal", startsAt: null, expiresAt: null, href: null, linkLabel: null, order: 2 });
  const withdrawnNotice = key(), editedNotice = key();
  async function publish(id: string, text: string, expectedRevision = 0) { const saved = await saveNotice(ctx, a, id, { expectedRevision, action: "save", draft: draft(text) }); return saveNotice(ctx, a, id, { expectedRevision: saved.revision, action: "publish" }); }
  const notice1 = await publish(withdrawnNotice, "Will be withdrawn"), notice2 = await publish(editedNotice, "Old body must not reappear");
  let late: Awaited<ReturnType<typeof createTopic>> | null = null;
  return {
    cases: ["topic-root-removed-keeps-third-party-replies", "whole-topic-hide-overrides-children", "latest-body-hash-mismatch-closed", "independent-lock-control", "chart-comment-hidden", "notice-withdraw-terminal", "notice-newer-body-not-reconstructed", "missing-topic-number-reserved", "deleted-author-evidence-erased", "historical-outbox-not-redelivered"],
    async commitLaterFacts() {
      await removeTopic(ctx, a, removed.publicId, removed.revision);
      await moderate(ctx, a, { topic: hidden.publicId }, { expectedRevision: hidden.revision, action: "hide", reason: "Restore fixture", publicReason: "Hidden" });
      const changed = await editTopic(ctx, a, edited.publicId, { expectedRevision: edited.revision, title: "New title missing from dump", body: "New body missing from dump", chartIds: [] });
      await moderate(ctx, a, { topic: edited.publicId }, { expectedRevision: changed.controlRevision, action: "lock", reason: "Restore lock", publicReason: "Locked" });
      await moderate(ctx, a, { message: comment.id }, { expectedRevision: comment.revision, action: "hide", reason: "Restore comment", publicReason: "Hidden" });
      await saveNotice(ctx, a, withdrawnNotice, { expectedRevision: notice1.revision, action: "withdraw" });
      await publish(editedNotice, "New body not in the snapshot", notice2.revision);
      const handlers = createDeletionHandlers(ctx);
      await requestDeletion({ db: ctx.db, boss: testSender, handlers }, doomed, { deleteContent: false });
      await ctx.db.update(user).set({ deletionPurgeAt: new Date(Date.now() - 1000) }).where(eq(user.id, doomed));
      expect(await purgeUser({ db: ctx.db, handlers }, doomed)).toBe("purged");
      late = await topic("Late URL reservation");
      await removeTopic(ctx, a, late.publicId, late.revision);
    },
    async verify(target: StorageContext) {
      const root = await getTopic(target, removed.publicId);
      expect(root.topic).toMatchObject({ state: "root_removed", title: null, body: null, locked: true });
      expect(root.replies.items.map(x => x.id)).toContain(replies[removed.id]!);
      expect((await listTopics(target, { q: "Root removed" })).items).toHaveLength(0);
      await expect(getTopic(target, hidden.publicId)).rejects.toMatchObject({ status: 404 });
      const unavailable = await getTopic(target, edited.publicId);
      expect(unavailable.topic).toMatchObject({ state: "unavailable", title: null, body: null, locked: true });
      expect(unavailable.replies.items.map(x => x.id)).toContain(replies[edited.id]!);
      expect((await listChartDiscussion(target, chart.id, { versionId: chart.currentVersionId })).items.some(x => x.id === comment.id)).toBe(false);
      expect(await getNotice(target, withdrawnNotice)).toMatchObject({ withdrawn: true, publication: null });
      const notices = await listNotices(target);
      expect(notices.items.some(x => ([withdrawnNotice, editedNotice] as string[]).includes(x.id))).toBe(false);
      expect(await getNotice(target, editedNotice)).toMatchObject({ publicationPending: true });
      const [id] = await target.db.select().from(forumPublicIds).where(eq(forumPublicIds.topicId, late!.id));
      expect(id.publicId.toString()).toBe(late!.publicId);
      await expect(getTopic(target, late!.publicId)).rejects.toMatchObject({ status: 404 });
      const retained = await getTopic(target, purged.publicId);
      expect(retained.topic).toMatchObject({ state: "root_removed", body: null, title: null, author: null });
      expect(retained.replies.items.map(x => x.id)).toContain(replies[purged.id]!);
      expect((await listReports(target, { status: "all" })).items.find(x => x.id === report.id)?.evidence).toBeNull();
      const pending = await target.db.execute(sql`select count(*)::int n from discussion_outbox where not completed`);
      expect(pending.rows[0]?.n).toBe(0);
    },
  };
}
