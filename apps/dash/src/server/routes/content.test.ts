import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { findContentFile } from "@astrodx/content-schema";

import type { ContentFileMeta, ContentFileResponse } from "@/shared/dto";

import { GitDataStepError } from "../github/client";
import { createFakeGitHubClient, type FakeSeed } from "../github/fake-client";
import type { AccessVariables } from "../middleware/access-jwt";
import { registerContentRoutes } from "./content";

/** 三个语言键齐全的一段文案——校验器要求 zh/en/ja 都在且非空。 */
function localized(text: string) {
  return { zh: text, en: text, ja: text };
}

// 两组数据：`seeded*` 是「仓库里现在是什么」，`edited*` 是「操作员改成了
// 什么」。两者必须不相等——路由会在提交前重读一遍、把内容没变的文件剔掉，
// 拿同一份数据当「改动」会让本该覆盖提交路径的测试悄悄走进「没有实际改动」
// 那条分支。
const seededCommunity = {
  contactChannels: [
    { name: localized("GitHub Issues"), url: "https://github.com/example/repo/issues" },
  ],
  communityChannels: [
    { name: localized("QQ 群"), url: "https://qm.qq.com/q/example", description: localized("日常交流") },
  ],
};

const editedCommunity = {
  contactChannels: [
    { name: localized("GitHub Issues"), url: "https://github.com/example/repo/issues" },
    { name: localized("Telegram"), url: "https://t.me/example" },
  ],
  communityChannels: seededCommunity.communityChannels,
};

const seededDonate = {
  methods: [
    { name: localized("爱发电"), url: "https://afdian.com/a/example", description: localized("月度赞助") },
  ],
};

const editedDonate = {
  methods: [
    { name: localized("爱发电"), url: "https://afdian.com/a/example", description: localized("改过的说明") },
  ],
};

const seededFriendLinks = {
  links: [
    { name: localized("友链示例"), url: "https://example.com", description: localized("示例站点") },
  ],
};

/** 与路由里的落盘格式一致：2 空格缩进 + 末尾换行。 */
function serialize(data: unknown): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

function pathOf(key: string): string {
  return findContentFile(key)!.path;
}

async function setup(overrides: Partial<FakeSeed> = {}) {
  const github = createFakeGitHubClient({
    files: {
      [pathOf("community")]: serialize(seededCommunity),
      [pathOf("donate")]: serialize(seededDonate),
      [pathOf("friend-links")]: serialize(seededFriendLinks),
    },
    ...overrides,
  });

  // 不挂 identity 中间件：这个路由不读 c.get("identity")。谁能打到它是
  // app.ts 的 accessJwt 的事，在 app.test.ts 里覆盖。
  const app = new Hono<{ Variables: AccessVariables }>();
  registerContentRoutes(app, { github });

  // blob sha 由假实现按正文算（见 fake-client 的 shaOf），测试不自己编一个：
  // 直接问它读到的是什么，跟客户端从 GET 拿到的是同一个值。
  const shaOf = async (key: string) => (await github.getContentFile(pathOf(key))).sha;

  return {
    seed: github.seed,
    shaOf,
    request: (path: string) => app.request(path),
    post: (body: unknown) =>
      app.request("/api/content/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    postRaw: (body: string) =>
      app.request("/api/content/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }),
  };
}

describe("GET /api/content", () => {
  test("列出全部已注册的内容文件", async () => {
    const { request } = await setup();

    const res = await request("/api/content");

    expect(res.status).toBe(200);
    const body = (await res.json()) as ContentFileMeta[];
    expect(body.map((file) => file.key)).toEqual(["community", "donate", "friend-links"]);
    expect(body[0]).toMatchObject({
      path: "apps/web/content/community.json",
      title: "社区与联系方式",
    });
  });
});

describe("GET /api/content/:key", () => {
  test("回解析好的 JSON，外加那一刻的 blob sha", async () => {
    const { request } = await setup();

    const res = await request("/api/content/community");

    expect(res.status).toBe(200);
    const body = (await res.json()) as ContentFileResponse;
    expect(body.data).toEqual(seededCommunity);
    // 不用 toBeString()：手写的 bun-test.d.ts 垫片里没有它，`bun test` 会绿
    // 而 `tsc --noEmit` 会红。
    expect(typeof body.sha).toBe("string");
    expect(body.sha.length).toBeGreaterThan(0);
  });

  test("未知的 key 回 404，且消息不把 key 回显出去", async () => {
    // 回显任意路径段等于给了一个反射点；这里只回一句固定的话。
    //
    // 路径整段百分号编码过：`app.request("/api/content/../../etc/passwd")`
    // 会先被 `new URL(...)` 规范化成 `/etc/passwd`，压根打不到这个路由，
    // 测的就不是想测的东西了。
    const { request } = await setup();

    const res = await request("/api/content/%2E%2E%2F%2E%2E%2Fetc%2Fpasswd");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "没有这个内容文件" });
  });

  test("仓库里的 JSON 坏了是 502，不是崩一个 500", async () => {
    const { request, seed } = await setup();
    seed.files[pathOf("community")] = "{ not json";

    const res = await request("/api/content/community");

    expect(res.status).toBe(502);
    // 连 body 一起断言：502 这个状态码光靠 withGitHubErrors 的默认分支也能
    // 凑出来，只看状态码的话这条测试对「这句话有没有传下去」是瞎的。
    expect(await res.json()).toEqual({
      error: "apps/web/content/community.json 不是合法的 JSON",
    });
  });
});

describe("POST /api/content/commit", () => {
  test("服务端自己校验一遍——客户端说没问题不算数", async () => {
    // 客户端校验可以被绕过——直打这个端点就行。这条测试锁的就是那件事。
    const { post, seed } = await setup();

    const res = await post({
      message: "m",
      files: [
        { key: "community", data: { contactChannels: [], communityChannels: [] }, baseSha: "x" },
      ],
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; errors: string[] };
    expect(body.error).toBe("校验未通过");
    expect(body.errors).toContain("社区与联系方式：contactChannels: 至少要有一个条目");
    expect(seed.commits).toHaveLength(0);
  });

  test("多个文件合成一次 commitFiles 调用", async () => {
    const { post, seed, shaOf } = await setup();

    const res = await post({
      message: "content: 更新",
      files: [
        { key: "community", data: editedCommunity, baseSha: await shaOf("community") },
        { key: "donate", data: editedDonate, baseSha: await shaOf("donate") },
      ],
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ accepted: true, commitSha: "commit-1" });
    expect(seed.commits).toHaveLength(1);
    expect(seed.commits[0].files.map((file) => file.path)).toEqual([
      "apps/web/content/community.json",
      "apps/web/content/donate.json",
    ]);
  });

  test("落盘格式是 2 空格缩进加末尾换行", async () => {
    const { post, seed, shaOf } = await setup();

    await post({
      message: "m",
      files: [{ key: "donate", data: editedDonate, baseSha: await shaOf("donate") }],
    });

    const written = seed.commits[0].files[0].content;
    expect(written.endsWith("\n")).toBe(true);
    expect(written).toBe(`${JSON.stringify(editedDonate, null, 2)}\n`);
  });

  test("内容没变的文件从这次 commit 里剔掉", async () => {
    const { post, seed, shaOf } = await setup();

    const res = await post({
      message: "m",
      files: [
        { key: "community", data: seededCommunity, baseSha: await shaOf("community") },
        { key: "donate", data: editedDonate, baseSha: await shaOf("donate") },
      ],
    });

    expect(res.status).toBe(200);
    expect(seed.commits[0].files.map((file) => file.path)).toEqual([
      "apps/web/content/donate.json",
    ]);
  });

  test("全部文件都没变：400，而不是推一个空 commit", async () => {
    const { post, seed, shaOf } = await setup();

    const res = await post({
      message: "m",
      files: [{ key: "community", data: seededCommunity, baseSha: await shaOf("community") }],
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "没有实际改动" });
    expect(seed.commits).toHaveLength(0);
  });

  test("baseSha 过期是 409，并点名是哪些文件", async () => {
    const { post } = await setup();

    const res = await post({
      message: "m",
      files: [{ key: "community", data: editedCommunity, baseSha: "stale" }],
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("已被改过"),
      step: "verify-blob",
      conflictPaths: ["apps/web/content/community.json"],
    });
  });

  test("提交中途失败时说明是哪一步失败的", async () => {
    const { post, seed, shaOf } = await setup();
    seed.commitError = new GitDataStepError("create-tree", "boom", 500);

    const res = await post({
      message: "m",
      files: [{ key: "community", data: editedCommunity, baseSha: await shaOf("community") }],
    });

    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ step: "create-tree" });
  });

  test("空的文件列表是 400——不能推一个空 commit 出去", async () => {
    // commitFiles 自己不拦空数组，会一路跑完六步推一个空 commit 上 main，
    // 白白触发一轮数分钟的完整部署。
    const { post, seed } = await setup();

    const res = await post({ message: "m", files: [] });

    expect(res.status).toBe(400);
    expect(seed.commits).toHaveLength(0);
  });

  test("文件列表里有未知的 key：400，且什么都不提交", async () => {
    const { post, seed } = await setup();

    const res = await post({ message: "m", files: [{ key: "nope", data: {}, baseSha: "x" }] });

    expect(res.status).toBe(400);
    expect(seed.commits).toHaveLength(0);
  });

  test("提交信息是空白：400——空的 commit 主题不可接受", async () => {
    const { post, shaOf } = await setup();

    const res = await post({
      message: "   ",
      files: [{ key: "community", data: editedCommunity, baseSha: await shaOf("community") }],
    });

    expect(res.status).toBe(400);
  });

  test("同一个 key 出现两次：400——哪一个生效是未定义的", async () => {
    const { post, seed, shaOf } = await setup();
    const file = { key: "community", data: editedCommunity, baseSha: await shaOf("community") };

    const res = await post({ message: "m", files: [file, file] });

    expect(res.status).toBe(400);
    expect(seed.commits).toHaveLength(0);
  });

  test("请求体不是 JSON：400", async () => {
    const { postRaw, seed } = await setup();

    const res = await postRaw("{ not json");

    expect(res.status).toBe(400);
    expect(seed.commits).toHaveLength(0);
  });

  test("文件列表里混进一个 null：400，而不是读 null.key 崩成 500", async () => {
    const { post, seed } = await setup();

    const res = await post({ message: "m", files: [null] });

    expect(res.status).toBe(400);
    expect(seed.commits).toHaveLength(0);
  });
});
