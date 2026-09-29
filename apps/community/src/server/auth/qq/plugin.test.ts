import { beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { createApp } from "../../app";
import { account, user } from "../../db/schema";
import { testAppDeps } from "../../testing/app-deps";
import {
  ageSessions,
  createTestAuth,
  currentUserId,
  googleProfile,
  randomQq,
  signInWithGoogle,
  signInWithQq,
  type TestAuthOptions,
  UNLIMITED,
  waitForCode,
} from "../../testing/auth";
import { Browser } from "../../testing/auth-browser";
import { resetTestDatabase, testDbHandle } from "../../testing/test-db";
import { maskQq } from "./sender";

beforeAll(async () => {
  await resetTestDatabase();
}, 30_000);

function setup(options?: TestAuthOptions) {
  const { auth, outbox, logs } = createTestAuth(options);
  return { app: createApp(testAppDeps({ auth }).deps), outbox, logs };
}

function sendCode(browser: Browser, qq: string, turnstileToken = "pass", locale?: string) {
  return browser.request("POST", "/api/auth/qq/send-code", { body: { qq, turnstileToken, ...(locale ? { locale } : {}) } });
}

describe("发码", () => {
  test("人机验证不通过返回 403，验证服务不可用返回 503，都不发码", async () => {
    const { app, outbox } = setup();
    const browser = new Browser(app);

    const failed = await sendCode(browser, randomQq(), "nope");
    const down = await sendCode(browser, randomQq(), "down");

    expect([failed.status, failed.json.code]).toEqual([403, "QQ_CAPTCHA_FAILED"]);
    expect([down.status, down.json.code]).toEqual([503, "QQ_CAPTCHA_UNAVAILABLE"]);
    expect(outbox).toEqual([]);
  });

  test("QQ 号格式不对返回 400", async () => {
    const { app } = setup();
    for (const qq of ["0123456", "1234", "123456789012", "12a45"]) {
      expect((await sendCode(new Browser(app), qq)).status, qq).toBe(400);
    }
  });

  test("按页面语言发码；响应里看不出是否真的发出", async () => {
    const { app, outbox } = setup();
    const qq = randomQq();

    const res = await sendCode(new Browser(app), qq, "pass", "ja");

    expect(res.status).toBe(200);
    expect(res.json).toEqual({ status: true });
    expect(await waitForCode(outbox, qq)).toMatch(/^\d{6}$/);
    expect(outbox.at(-1)).toMatchObject({ qq, locale: "ja" });
  });

  test("发送失败时照样返回同样的结果；失败日志里没有 QQ 号，也没有验证码", async () => {
    const sentCodes: string[] = [];
    const { app, logs } = setup({
      sendCode: async (_qq, code) => {
        sentCodes.push(code);
        throw new Error("send_private_msg timed out");
      },
    });
    const qq = randomQq();

    const res = await sendCode(new Browser(app), qq);

    expect(res.status).toBe(200);
    expect(res.json).toEqual({ status: true });
    // 发送在后台跑：等它失败、记下日志。
    const failures = () => logs().filter((entry) => entry.event === "qq_send_failed");
    const deadline = Date.now() + 1000;
    while (failures().length === 0 && Date.now() < deadline) {
      await Bun.sleep(5);
    }
    expect(failures()).toHaveLength(1);
    const [code = ""] = sentCodes;
    expect(code).toMatch(/^\d{6}$/);
    const line = JSON.stringify(failures()[0]);
    expect(line).not.toContain(qq);
    expect(line).not.toContain(code);
  });

  test("发送卡住时发码接口不等它，照样马上返回同样的结果", async () => {
    const { app } = setup({ sendCode: () => new Promise<void>(() => undefined) });

    const res = await Promise.race([sendCode(new Browser(app), randomQq()), Bun.sleep(1000).then(() => null)]);

    expect(res?.status).toBe(200);
    expect(res?.json).toEqual({ status: true });
  });

  test("发给 Turnstile 的是 Cloudflare 给的原始访客 IP，IPv6 不截成 /64", async () => {
    const seen: (string | null)[] = [];
    const { app } = setup({
      turnstile: async (_token, remoteIp) => {
        seen.push(remoteIp);
        return "ok";
      },
    });

    await sendCode(new Browser(app, { ip: "2001:db8:1234:5678:9abc:def0:1234:5678" }), randomQq());

    expect(seen).toEqual(["2001:db8:1234:5678:9abc:def0:1234:5678"]);
  });

  test("同一个 QQ 号一分钟内只能发一次", async () => {
    const { app } = setup();
    const browser = new Browser(app);
    const qq = randomQq();

    expect((await sendCode(browser, qq)).status).toBe(200);
    const again = await sendCode(browser, qq);

    expect([again.status, again.json.code]).toEqual([429, "QQ_SEND_RATE_LIMITED"]);
  });

  // Better Auth 自带的按 IP 计数：每小时 20 次（spec 第 10.2 节）。默认只在线上开，这里显式打开。
  test("限流打开时，同一 IP 一小时内第 21 次发码返回 429", async () => {
    const { app } = setup({ rateLimitEnabled: true });
    const browser = new Browser(app, { ip: "198.51.100.77" });
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      statuses.push((await sendCode(browser, randomQq())).status);
    }

    expect(statuses.slice(0, 20).every((status) => status === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
  });
});

describe("验证码登录", () => {
  test("第一次登录建号：昵称来自 QQ，绑定上存着昵称，同时登录", async () => {
    const qq = randomQq();
    const { app, outbox } = setup({ nicknames: { [qq]: "小马哥" } });
    const browser = new Browser(app);

    const { verified } = await signInWithQq(browser, outbox, qq);

    expect(verified.status).toBe(200);
    expect(verified.json).toMatchObject({ isNewUser: true, user: { name: "小马哥" } });
    const userId = await currentUserId(browser);
    const [row] = await testDbHandle().db.select().from(user).where(eq(user.id, userId));
    expect(row).toMatchObject({ name: "小马哥", email: `${userId}@placeholder.invalid` });
    const [binding] = await testDbHandle().db.select().from(account).where(eq(account.userId, userId));
    expect(binding).toMatchObject({ providerId: "qq", accountId: qq, providerNickname: "小马哥" });
  });

  test("查不到昵称时，用打码的 QQ 号当昵称", async () => {
    const { app, outbox } = setup();
    const browser = new Browser(app);

    const { qq, verified } = await signInWithQq(browser, outbox);

    expect(verified.json.user.name).toBe(`QQ ${maskQq(qq)}`);
    // 打码的 QQ 号只当显示名：绑定上的"QQ 昵称"只存真的查到的，查不到就留空。
    const bindings = await testDbHandle()
      .db.select()
      .from(account)
      .where(and(eq(account.providerId, "qq"), eq(account.accountId, qq)));
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({ userId: verified.json.user.id, providerNickname: null });
  });

  test("已经绑定的 QQ 直接登录同一个用户", async () => {
    const first = setup();
    const firstBrowser = new Browser(first.app);
    const { qq } = await signInWithQq(firstBrowser, first.outbox);
    // 换一个实例：每个实例的按 QQ 号限流是分开的，否则一分钟内不能对同一个号发第二次。
    const second = setup();
    const secondBrowser = new Browser(second.app);

    const { verified } = await signInWithQq(secondBrowser, second.outbox, qq);

    expect(verified.json.isNewUser).toBe(false);
    expect(await currentUserId(secondBrowser)).toBe(await currentUserId(firstBrowser));
  });

  test("换一个浏览器（没有发码时的 Cookie）验证不了", async () => {
    const { app, outbox } = setup();
    const qq = randomQq();
    await sendCode(new Browser(app), qq);
    const code = await waitForCode(outbox, qq);

    const res = await new Browser(app).request("POST", "/api/auth/qq/verify", { body: { qq, code } });

    expect([res.status, res.json.code]).toEqual([400, "QQ_CODE_EXPIRED"]);
  });

  test("输错 5 次后验证码作废", async () => {
    const { app, outbox } = setup();
    const browser = new Browser(app);
    const qq = randomQq();
    await sendCode(browser, qq);
    const code = await waitForCode(outbox, qq);
    const wrong = code === "000000" ? "111111" : "000000";

    const results: string[] = [];
    for (let i = 0; i < 5; i++) {
      results.push((await browser.request("POST", "/api/auth/qq/verify", { body: { qq, code: wrong } })).json.code);
    }
    const afterwards = await browser.request("POST", "/api/auth/qq/verify", { body: { qq, code } });

    expect(results).toEqual([
      "QQ_CODE_INVALID",
      "QQ_CODE_INVALID",
      "QQ_CODE_INVALID",
      "QQ_CODE_INVALID",
      "QQ_CODE_TOO_MANY_ATTEMPTS",
    ]);
    expect(afterwards.json.code).toBe("QQ_CODE_EXPIRED");
  });

  test("同一个验证码只能用一次", async () => {
    const { app, outbox } = setup();
    const browser = new Browser(app);
    const qq = randomQq();
    await sendCode(browser, qq);
    const code = await waitForCode(outbox, qq);

    expect((await browser.request("POST", "/api/auth/qq/verify", { body: { qq, code } })).status).toBe(200);
    const again = await browser.request("POST", "/api/auth/qq/verify", { body: { qq, code } });

    expect(again.json.code).toBe("QQ_CODE_EXPIRED");
  });

  // 审查发现的漏洞：同一个 qq_code Cookie，19 个错误码和正确码同时打过来，正确码最后发出。每个请求换一个
  // IP：按 IP 限流挡不住这种猜法。尝试次数在比对之前原子地占用，正确码只有排进前 5 次占用才会被比对；
  // 最后发出的它要越过 15 个先发的请求才排得进去，所以这个断言在实际中是稳定的。
  test("并发猜码也只比对 5 次：最后发出的正确码登录不了", async () => {
    const { app, outbox } = setup();
    const browser = new Browser(app);
    const qq = randomQq();
    await sendCode(browser, qq);
    const code = await waitForCode(outbox, qq);
    const wrong = new Set<string>();
    while (wrong.size < 19) {
      const guess = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
      if (guess !== code) {
        wrong.add(guess);
      }
    }

    const results = await Promise.all(
      [...wrong, code].map((guess, i) => {
        const guesser = new Browser(app, { ip: `198.51.100.${10 + i}` });
        for (const [name, value] of browser.cookies) {
          guesser.cookies.set(name, value);
        }
        return guesser.request("POST", "/api/auth/qq/verify", { body: { qq, code: guess } });
      })
    );
    const summary = results.map((res) => (res.status === 200 ? "OK" : String(res.json?.code)));

    expect(summary.at(-1)).not.toBe("OK");
    expect(summary.filter((entry) => entry === "QQ_CODE_INVALID").length).toBeLessThanOrEqual(4);
    expect(
      summary.filter(
        (entry) => entry !== "QQ_CODE_INVALID" && entry !== "QQ_CODE_TOO_MANY_ATTEMPTS" && entry !== "QQ_CODE_EXPIRED"
      )
    ).toEqual([]);
  }, 20_000);
});

describe("绑定 QQ", () => {
  test("已登录时绑到当前账号；没登录时拒绝且不消耗验证码；已经绑在别人名下的返回 409", async () => {
    const { app, outbox } = setup({ qqLimits: UNLIMITED });
    const alice = new Browser(app);
    await signInWithGoogle(alice, googleProfile());
    const aliceId = await currentUserId(alice);

    const qqA = randomQq();
    await sendCode(alice, qqA);
    const linked = await alice.request("POST", "/api/auth/qq/verify", {
      body: { qq: qqA, code: await waitForCode(outbox, qqA), intent: "link" },
    });
    expect(linked.json).toEqual({ linked: true });
    const bindings = await testDbHandle().db.select().from(account).where(eq(account.userId, aliceId));
    expect(bindings.map((row) => row.providerId).sort()).toEqual(["google", "qq"]);

    const stranger = new Browser(app);
    const qqB = randomQq();
    await sendCode(stranger, qqB);
    const codeB = await waitForCode(outbox, qqB);
    const refused = await stranger.request("POST", "/api/auth/qq/verify", { body: { qq: qqB, code: codeB, intent: "link" } });
    expect([refused.status, refused.json.code]).toEqual([401, "QQ_LINK_REQUIRES_SESSION"]);
    // 验证码还在：改走登录照样能用，stranger 因此成了 qqB 的主人。
    expect((await stranger.request("POST", "/api/auth/qq/verify", { body: { qq: qqB, code: codeB } })).status).toBe(200);

    const before = outbox.length;
    await sendCode(alice, qqB);
    const conflict = await alice.request("POST", "/api/auth/qq/verify", {
      body: { qq: qqB, code: await waitForCode(outbox, qqB, before), intent: "link" },
    });
    expect([conflict.status, conflict.json.code]).toEqual([409, "QQ_ALREADY_LINKED"]);
  });

  // Ruling R9：绑定新的登录方式也算敏感操作，和 /link-social 一样要求会话 10 分钟内创建，
  // 否则偷来的旧会话能绑一个攻击者自己的 QQ，再用它正常登录一次，之后就有了一个"刚登录"的会话。
  test("会话超过 10 分钟时，绑定 QQ 要求重新登录，且没有消耗验证码", async () => {
    const { app, outbox } = setup({ qqLimits: UNLIMITED });
    const alice = new Browser(app);
    await signInWithGoogle(alice, googleProfile());
    const aliceId = await currentUserId(alice);
    await ageSessions(aliceId, 11);

    const qq = randomQq();
    await sendCode(alice, qq);
    const code = await waitForCode(outbox, qq);
    const stale = await alice.request("POST", "/api/auth/qq/verify", { body: { qq, code, intent: "link" } });

    expect([stale.status, stale.json.code]).toEqual([403, "REAUTH_REQUIRED"]);
    const bindings = await testDbHandle().db.select().from(account).where(eq(account.userId, aliceId));
    expect(bindings.map((row) => row.providerId)).toEqual(["google"]);

    // 验证码没被拒绝的这次请求消耗掉：改走登录（不传 intent）照样能用。
    const loggedIn = await alice.request("POST", "/api/auth/qq/verify", { body: { qq, code } });
    expect(loggedIn.status).toBe(200);
  });
});
