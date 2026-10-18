import assert from "node:assert/strict";
import { join } from "node:path";

/** Actual Chromium against disposable fixtures: every write below uses a visible form. */
export async function exercisePlatform({ owner, other, anonymous, page, origin, chart, evidenceDirectory, step }) {
  const contributor = await other.newPage();
  const errors = [];
  contributor.on("pageerror", error => errors.push(error.message));
  const url = path => new URL(path, origin).href;
  const read = async (context, path) => {
    const response = await context.request.get(url(path));
    assert.equal(response.status(), 200, path); return response.json();
  };
  const mutation = async (target, path, method, action) => {
    const [response] = await Promise.all([target.waitForResponse(r => new URL(r.url()).pathname === path && r.request().method() === method, { timeout: 60000 }), action()]);
    assert.ok(response.ok(), `${method} ${path}: ${response.status()}`); return response.json();
  };
  let root, topic, forumReply;
  try {
    await step("platform_chart_comment_timepoint_and_direct_reply", async () => {
      await contributor.goto(url(`/charts/${chart.publicId}`));
      const composer = contributor.locator("#chart-discussion-composer form");
      await composer.getByRole("textbox", { name: "回复内容", exact: true }).fill("Browser current-version root");
      await composer.getByRole("combobox", { name: "难度", exact: true }).selectOption("4");
      await composer.getByLabel("时间点（谱面毫秒，可留空）", { exact: true }).fill("250");
      root = await mutation(contributor, `/api/v1/discussions/charts/${chart.publicId}/messages`, "POST", () => composer.getByRole("button", { name: "明确提交", exact: true }).click());
      await contributor.locator(`#message-${root.id}`).getByText("Browser current-version root", { exact: true }).waitFor();
      await contributor.locator(`#message-${root.id}`).getByRole("button", { name: "00:00.250", exact: true }).click();
      await contributor.locator("#chart-preview canvas").waitFor();
      await contributor.locator("#chart-preview").getByRole("button", { name: "播放", exact: true }).click({trial:true,timeout:30000});
      await page.goto(url(`/charts/${chart.publicId}`));
      await page.locator(`#message-${root.id}`).getByRole("button", { name: "回复内容", exact: true }).click();
      const answer = page.locator("#chart-discussion-composer form");
      await answer.getByRole("textbox", { name: "回复内容", exact: true }).fill("Browser publisher reply");
      const saved = await mutation(page, `/api/v1/discussions/charts/${chart.publicId}/messages`, "POST", () => answer.getByRole("button", { name: "明确提交", exact: true }).click());
      assert.equal(saved.rootId, root.id); assert.equal(saved.publisher, true);
      await page.locator(`#message-${saved.id}`).getByText("Browser publisher reply", { exact: true }).waitFor();
      if (evidenceDirectory) await page.screenshot({ path: join(evidenceDirectory, "platform-comments.png"), fullPage: true });
    });
    await step("platform_forum_publish_markdown_link_and_subscription", async () => {
      // The real account-wide cooldown applies across chart comments and forum posts.
      await new Promise(resolve => setTimeout(resolve, 10500));
      await contributor.goto(url(`/forum/new?chart=${chart.publicId}`));
      await contributor.getByRole("textbox", { name: "标题", exact: true }).fill("Browser forum topic");
      await contributor.getByRole("textbox", { name: "正文", exact: true }).fill("# Browser topic\n\n- First item\n- Second item\n\n<script id=unsafe-browser-topic>not executable</script>\n\n[External](https://example.com)");
      topic = await mutation(contributor, "/api/v1/discussions/topics", "POST", () => contributor.getByRole("button", { name: "明确提交", exact: true }).click());
      assert.match(topic.publicId, /^[1-9]\d*$/);
      await contributor.waitForURL(at => at.pathname === `/forum/${topic.publicId}`);
      await contributor.getByRole("heading", { level: 1, name: "Browser forum topic", exact: true }).waitFor();
      assert.equal(await contributor.locator("script#unsafe-browser-topic").count(), 0);
      assert.match(await contributor.getByRole("link", { name: "External", exact: true }).getAttribute("rel"), /noopener/);
      assert.equal(topic.linkedCharts[0]?.publicId, chart.publicId);
      await page.goto(url(`/forum/${topic.publicId}`));
      await page.getByRole("button", { name: "订阅主题", exact: true }).click();
      await page.getByRole("button", { name: "取消订阅", exact: true }).waitFor();
      const reply = page.locator("#topic-reply-editor form");
      await reply.getByRole("textbox", { name: "回复内容", exact: true }).fill("Browser forum reply");
      forumReply = await mutation(page, `/api/v1/discussions/topics/${topic.publicId}/replies`, "POST", () => reply.getByRole("button", { name: "明确提交", exact: true }).click());
      await page.locator(`#message-${forumReply.id}`).getByText("Browser forum reply", { exact: true }).waitFor();
      const visitor = await anonymous.newPage();
      await visitor.goto(url(`/forum?chart=${chart.publicId}`));
      await visitor.getByRole("link", { name: "Browser forum topic", exact: true }).waitFor();
      await visitor.getByRole("link", { name: "Browser forum topic", exact: true }).click();
      await visitor.getByText("Browser forum reply", { exact: true }).waitFor();
      if (evidenceDirectory) await visitor.screenshot({ path: join(evidenceDirectory, "platform-forum.png"), fullPage: true });
      for (const width of [320, 390]) { await visitor.setViewportSize({ width, height: 844 }); assert.equal(await visitor.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true); }
      await visitor.close();
    });
    await step("platform_real_worker_notifications_and_read_controls", async () => {
      const deadline = Date.now() + 80000;
      for (;;) {
        const inbox = await read(other, "/api/v1/discussions/notifications");
        if (inbox.items.some(item => item.kind === "direct_reply") && inbox.items.some(item => item.kind === "subscription")) break;
        assert.ok(Date.now() < deadline, "real scheduled outbox worker must deliver both notification kinds");
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      await contributor.goto(url("/me/notifications"));
      await mutation(contributor,"/api/v1/discussions/notifications/read","POST",()=>contributor.getByRole("button", { name: "本页未读标为已读", exact: true }).click());
      assert.equal((await read(other, "/api/v1/discussions/notifications?unread=true")).unreadCount, 0);
      if (evidenceDirectory) await contributor.screenshot({ path: join(evidenceDirectory, "platform-notifications.png"), fullPage: true });
    });
    await step("platform_report_and_admin_hide_exact_forum_reply", async () => {
      await contributor.goto(url(`/forum/${topic.publicId}`));
      const message = contributor.locator(`#message-${forumReply.id}`);
      await message.getByRole("button", { name: "举报此内容", exact: true }).click();
      await message.getByLabel("情况说明（必填，最多 500 字）", { exact: true }).fill("Synthetic browser report");
      const report = await mutation(contributor, "/api/v1/discussions/reports", "POST", () => message.getByRole("button", { name: "提交举报", exact: true }).click());
      await page.goto(url(`/dash/discussions?kind=message&scope=forum_reply&targetId=${forumReply.id}`));
      const row = page.getByRole("article").filter({ hasText: "Browser forum reply" });
      await row.getByLabel("内部管理原因（1–500 字）", { exact: true }).fill("Synthetic isolated browser review");
      await row.getByLabel("告知当事人的原因（1–500 字）", { exact: true }).fill("Synthetic isolated hide");
      await row.getByLabel("我已核对目标、版本与原因，确认执行此操作。", { exact: true }).check();
      await mutation(page, `/api/v1/discussions/dash/messages/${forumReply.id}/moderation`, "POST", () => row.getByRole("button", { name: "应用", exact: true }).click());
      await row.getByLabel("内部管理原因（1–500 字）", { exact: true }).waitFor({ state: "hidden" });
      await contributor.reload();
      assert.equal(await contributor.getByText("Browser forum reply", { exact: true }).count(), 0);
      assert.equal((await read(owner, `/api/v1/discussions/dash/reports?status=open`)).items.some(item => item.id === report.id), true);
      await page.goto(url("/dash/discussions?view=reports"));
      const review = page.getByRole("article").filter({ hasText: "Synthetic browser report" });
      await review.getByLabel("处理结果", { exact: true }).selectOption("actioned");
      await review.getByLabel("处理说明（举报者可见）", { exact: true }).fill("Synthetic report resolved after exact-target hide");
      await review.getByLabel("我确认保存此处理结果；保存后不能改写。", { exact: true }).check();
      await mutation(page, `/api/v1/discussions/dash/reports/${report.id}/resolution`, "POST", () => review.getByRole("button", { name: "确认处理", exact: true }).click());
      if (evidenceDirectory) await page.screenshot({ path: join(evidenceDirectory, "platform-discussion-admin.png"), fullPage: true });
    });
    await step("platform_featured_and_notice_draft_publish_withdraw", async () => {
      await page.goto(url("/dash/featured"));
      await page.getByLabel("精选编号（每行一个）", { exact: true }).fill(chart.publicId);
      await page.getByLabel("已核对这次操作及其公开影响", { exact: true }).check();
      await mutation(page, "/api/v1/site/dash/featured", "PUT", () => page.getByRole("button", { name: "保存", exact: true }).click());
      assert.deepEqual((await read(anonymous, "/api/v1/site/featured")).ids, [chart.publicId]);
      await page.goto(url("/dash/notices"));
      await page.getByRole("button", { name: "新建公告", exact: true }).click();
      const editor = page.locator("form").first();
      await editor.getByRole("textbox", { name: "标题", exact: true }).first().fill("Browser site notice");
      await editor.getByRole("textbox", { name: "正文", exact: true }).first().fill("Public browser notice");
      // The new notice UUID is client generated; match this single PUT without exposing session data.
      const [response] = await Promise.all([page.waitForResponse(r => /^\/api\/v1\/site\/dash\/notices\/[a-f0-9-]+$/.test(new URL(r.url()).pathname) && r.request().method() === "PUT"), editor.getByRole("button", { name: "保存草稿", exact: true }).click()]);
      assert.equal(response.status(), 200); const notice = await response.json();
      await editor.getByLabel("已核对这次操作及其公开影响", { exact: true }).check();
      await mutation(page, `/api/v1/site/dash/notices/${notice.id}`, "PUT", () => editor.getByRole("button", { name: "发布已保存草稿", exact: true }).click());
      const visitor = await anonymous.newPage(); await visitor.goto(url("/notices"));
      await visitor.getByText("Public browser notice", { exact: true }).waitFor();
      if (evidenceDirectory) await visitor.screenshot({ path: join(evidenceDirectory, "platform-notices.png"), fullPage: true });
      await editor.getByLabel("已核对这次操作及其公开影响", { exact: true }).check();
      await mutation(page, `/api/v1/site/dash/notices/${notice.id}`, "PUT", () => editor.getByRole("button", { name: "撤回公告", exact: true }).click());
      await visitor.reload(); assert.equal(await visitor.getByText("Public browser notice", { exact: true }).count(), 0); await visitor.close();
    });
    assert.deepEqual(errors, []);
  } finally {
    await contributor.close();
    await page.goto(url(`/me/charts/${chart.id}`));
  }
}
