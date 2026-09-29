import { beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { createApp } from "../app";
import { account, passkey, user } from "../db/schema";
import { testAppDeps } from "../testing/app-deps";
import {
  ageSessions,
  createTestAuth,
  currentUserId,
  googleProfile,
  signInWithGoogle,
  type TestAuthOptions,
} from "../testing/auth";
import { Browser } from "../testing/auth-browser";
import { TEST_PUBLIC_ORIGIN } from "../testing/constants";
import { SoftAuthenticator } from "../testing/soft-authenticator";
import { resetTestDatabase, testDbHandle } from "../testing/test-db";

const RP_ID = new URL(TEST_PUBLIC_ORIGIN).hostname;

// TEST_PUBLIC_ORIGIN 是 https，所以 Cookie 名带 __Secure- 前缀。
const SESSION_COOKIE = "__Secure-adxc.session_token";

// 碰数据库的测试都显式给了 30_000 的超时：测试库在隧道另一端，一个测试要来回十几次，隧道慢的时候 2 到 5 秒
// 不稀奇；默认的 5s 是给本机直连的 Postgres 设的（同 me.test.ts）。
beforeAll(async () => {
  await resetTestDatabase();
}, 30_000);

function newApp(options?: TestAuthOptions) {
  return createApp(testAppDeps({ auth: createTestAuth(options).auth }).deps);
}

function signupQuery(nickname: string, turnstileToken = "pass") {
  return `context=${encodeURIComponent(JSON.stringify({ nickname, turnstileToken }))}`;
}

// 只用通行密钥注册；默认带 createSession: true（前端总是这样调）。
async function signUp(browser: Browser, authn: SoftAuthenticator, nickname: string, createSession = true) {
  const options = await browser.request("GET", `/api/auth/passkey/generate-register-options?${signupQuery(nickname)}`);
  const response = await authn.createCredential(options.json);
  return browser.request("POST", "/api/auth/passkey/verify-registration", {
    body: createSession ? { response, createSession: true } : { response },
  });
}

async function signIn(browser: Browser, authn: SoftAuthenticator, credential = authn.credentials.at(-1)) {
  const options = await browser.request("GET", "/api/auth/passkey/generate-authenticate-options");
  return browser.request("POST", "/api/auth/passkey/verify-authentication", {
    body: { response: await authn.getAssertion(options.json, credential) },
  });
}

// 已登录时再加一个通行密钥（不带 context）。
async function addPasskey(browser: Browser, authn: SoftAuthenticator) {
  const options = await browser.request("GET", "/api/auth/passkey/generate-register-options");
  if (options.status !== 200) {
    return options;
  }
  return browser.request("POST", "/api/auth/passkey/verify-registration", {
    body: { response: await authn.createCredential(options.json) },
  });
}

function usersNamed(name: string) {
  return testDbHandle().db.select().from(user).where(eq(user.name, name));
}

function passkeysOf(userId: string) {
  return testDbHandle().db.select().from(passkey).where(eq(passkey.userId, userId));
}

function uniqueNickname() {
  return `密钥用户${crypto.randomUUID().slice(0, 8)}`;
}

describe("只用通行密钥注册", () => {
  test("人机验证不过、验证服务不可用、昵称或参数不合法时，拿不到注册选项", async () => {
    const browser = new Browser(newApp());
    const get = (query: string) => browser.request("GET", `/api/auth/passkey/generate-register-options?${query}`);

    const failed = await get(signupQuery("阿丁", "nope"));
    const down = await get(signupQuery("阿丁", "down"));
    const blank = await get(signupQuery("  \u0007 "));
    const garbage = await get("context=not-json");

    expect([failed.status, failed.json.code]).toEqual([403, "SIGNUP_CAPTCHA_FAILED"]);
    expect([down.status, down.json.code]).toEqual([503, "SIGNUP_CAPTCHA_UNAVAILABLE"]);
    expect([blank.status, blank.json.code]).toEqual([400, "SIGNUP_INVALID"]);
    expect([garbage.status, garbage.json.code]).toEqual([400, "SIGNUP_INVALID"]);
  });

  // Better Auth 自己的 getIP 会把 IPv6 截成 /64（给限流用的），那样发给 Cloudflare 的就不是访客的真实地址了。
  test("人机验证收到的是访客的原始 IP：IPv6 不截成 /64", async () => {
    const seen: (string | null)[] = [];
    const app = newApp({
      turnstile: async (token, remoteIp) => {
        seen.push(remoteIp);
        return token === "pass" ? "ok" : "failed";
      },
    });
    const browser = new Browser(app, { ip: "2001:db8:1:2:3:4:5:6" });

    const res = await signUp(browser, new SoftAuthenticator(TEST_PUBLIC_ORIGIN, RP_ID), uniqueNickname());

    expect(res.status).toBe(200);
    expect(seen).toEqual(["2001:db8:1:2:3:4:5:6"]);
  }, 30_000);

  test("没带 createSession 时拒绝，而且不建号", async () => {
    const nickname = uniqueNickname();

    const res = await signUp(new Browser(newApp()), new SoftAuthenticator(TEST_PUBLIC_ORIGIN, RP_ID), nickname, false);

    expect([res.status, res.json.code]).toEqual([400, "SIGNUP_SESSION_REQUIRED"]);
    expect(await usersNamed(nickname)).toEqual([]);
  }, 30_000);

  test("注册成功：一个新用户（短 id、占位邮箱、昵称），通行密钥挂在他名下，同时登录", async () => {
    const browser = new Browser(newApp());
    const nickname = uniqueNickname();

    const res = await signUp(browser, new SoftAuthenticator(TEST_PUBLIC_ORIGIN, RP_ID), nickname);

    expect(res.status).toBe(200);
    const userId = await currentUserId(browser);
    expect(userId).toMatch(/^[2-9a-hjkmnp-z]{10}$/);
    expect(await usersNamed(nickname)).toEqual([
      expect.objectContaining({ id: userId, email: `${userId}@placeholder.invalid` }),
    ]);
    expect(await passkeysOf(userId)).toHaveLength(1);
  }, 30_000);

  // credential_id 全表唯一。插件先建号再存通行密钥，存的时候撞上唯一约束，整个事务回滚。
  test("同一个凭据不能再注册一个账号；失败时不留下空用户", async () => {
    const app = newApp();
    const authn = new SoftAuthenticator(TEST_PUBLIC_ORIGIN, RP_ID);
    await signUp(new Browser(app), authn, uniqueNickname());
    const reusedId = authn.credentials[0]?.id;
    const nickname = uniqueNickname();

    const browser = new Browser(app);
    const options = await browser.request("GET", `/api/auth/passkey/generate-register-options?${signupQuery(nickname)}`);
    const response = await authn.createCredential(options.json, reusedId);
    const res = await browser.request("POST", "/api/auth/passkey/verify-registration", {
      body: { response, createSession: true },
    });

    // 插件只会把非 APIError（这里是 PG 的唯一约束错误）映射成这个错误码，所以它证明请求走到了"存通行密钥"
    // 这一步：用户已经在同一个事务里建出来了，下面查不到他，说明回滚真的发生了。
    expect([res.status, res.json.code]).toEqual([500, "FAILED_TO_VERIFY_REGISTRATION"]);
    expect(await usersNamed(nickname)).toEqual([]);
  }, 30_000);

  // verify-registration 的 name 是客户端随便写的字段：1b 的前端从不发它（名字来自认证器型号），
  // 这条规则只挡手工构造的请求。
  test("注册时带的通行密钥名字：空白、超过 64 个码点、带控制字符、不是字符串都拒绝，而且不建号；正好 64 个码点可以", async () => {
    const browser = new Browser(newApp());
    const nickname = uniqueNickname();
    const options = await browser.request("GET", `/api/auth/passkey/generate-register-options?${signupQuery(nickname)}`);
    const response = await new SoftAuthenticator(TEST_PUBLIC_ORIGIN, RP_ID).createCredential(options.json);
    const verify = (name: unknown) =>
      browser.request("POST", "/api/auth/passkey/verify-registration", {
        body: { response, createSession: true, name },
      });
    const rejected: [string, unknown][] = [
      ["65 个字符", "A".repeat(65)],
      // 表情符号在 UTF-16 里占两个单元：按码点数，65 个也是超了。
      ["65 个码点", "😀".repeat(65)],
      ["控制字符", "abc\u0007def"],
      ["空白", "   "],
      ["null", null],
      ["数字", 123],
    ];

    // 这个钩子在插件消耗挑战之前就拒绝，所以同一份注册响应可以接着再试。
    for (const [label, name] of rejected) {
      const res = await verify(name);
      expect([res.status, res.json.code], label).toEqual([400, "PASSKEY_NAME_INVALID"]);
    }
    expect(await usersNamed(nickname)).toEqual([]);

    const exact = "😀".repeat(64);
    expect((await verify(exact)).status).toBe(200);
    const userId = await currentUserId(browser);
    expect((await passkeysOf(userId)).map((row) => row.name)).toEqual([exact]);
  }, 30_000);

  // 6 = 测试连接池上限（test-db.ts 里是 5）+ 1。注册事务各占着一个连接；以前 user.create.before 里还要再从池里
  // 另要一个连接去查 id 有没有被占用，"池大小 + 1"个新用户同时进来时，事务全都在等第二个连接，互相等死，
  // 约 5 秒后一起返回 500（线上池是 10）。
  test("同时 6 个人只用通行密钥注册（连接池上限 5 + 1）：全部成功，各自建出了用户", async () => {
    const app = newApp();
    const prepared = [];
    for (let i = 0; i < 6; i++) {
      const browser = new Browser(app, { ip: `203.0.113.${10 + i}` });
      const nickname = uniqueNickname();
      const options = await browser.request("GET", `/api/auth/passkey/generate-register-options?${signupQuery(nickname)}`);
      const response = await new SoftAuthenticator(TEST_PUBLIC_ORIGIN, RP_ID).createCredential(options.json);
      prepared.push({ browser, nickname, response });
    }

    const results = await Promise.all(
      prepared.map(({ browser, response }) =>
        browser.request("POST", "/api/auth/passkey/verify-registration", { body: { response, createSession: true } })
      )
    );

    expect(results.map((res) => res.status)).toEqual([200, 200, 200, 200, 200, 200]);
    for (const { nickname } of prepared) {
      expect(await usersNamed(nickname)).toHaveLength(1);
    }
  }, 30_000);
});

describe("通行密钥登录和管理", () => {
  test("登录，并记下最后使用时间", async () => {
    const app = newApp();
    const authn = new SoftAuthenticator(TEST_PUBLIC_ORIGIN, RP_ID);
    const first = new Browser(app);
    await signUp(first, authn, uniqueNickname());
    const userId = await currentUserId(first);
    // 注册时不算"使用"：登录前是空的，下面的断言才说明它是登录写进去的。
    expect((await passkeysOf(userId))[0]?.lastUsedAt).toBeNull();

    const second = new Browser(app);
    const res = await signIn(second, authn);

    expect(res.status).toBe(200);
    expect(await currentUserId(second)).toBe(userId);
    const [row] = await passkeysOf(userId);
    expect(row?.lastUsedAt).toBeInstanceOf(Date);
  }, 30_000);

  test("已登录添加：注册选项里的用户名是昵称，不是占位邮箱；超过 10 分钟要求重新登录", async () => {
    const browser = new Browser(newApp());
    const nickname = uniqueNickname();
    await signUp(browser, new SoftAuthenticator(TEST_PUBLIC_ORIGIN, RP_ID), nickname);
    const userId = await currentUserId(browser);

    const options = await browser.request("GET", "/api/auth/passkey/generate-register-options");
    expect(options.json.user).toMatchObject({ name: nickname, displayName: nickname });
    const laptop = new SoftAuthenticator(TEST_PUBLIC_ORIGIN, RP_ID);
    const added = await browser.request("POST", "/api/auth/passkey/verify-registration", {
      body: { response: await laptop.createCredential(options.json) },
    });
    expect(added.status).toBe(200);
    expect(await passkeysOf(userId)).toHaveLength(2);

    await ageSessions(userId, 11);
    const stale = await addPasskey(browser, new SoftAuthenticator(TEST_PUBLIC_ORIGIN, RP_ID));
    expect([stale.status, stale.json.code]).toEqual([403, "REAUTH_REQUIRED"]);
  }, 30_000);

  test("删除：要求刚登录过；不能删最后一种登录方式；id 不是 uuid 时返回 404 而不是 500", async () => {
    const browser = new Browser(newApp());
    const phone = new SoftAuthenticator(TEST_PUBLIC_ORIGIN, RP_ID);
    await signUp(browser, phone, uniqueNickname());
    const userId = await currentUserId(browser);
    await addPasskey(browser, new SoftAuthenticator(TEST_PUBLIC_ORIGIN, RP_ID));
    const [firstKey, secondKey] = await passkeysOf(userId);
    const remove = (id: string | undefined) =>
      browser.request("POST", "/api/auth/passkey/delete-passkey", { body: { id } });

    await ageSessions(userId, 11);
    const stale = await remove(secondKey?.id);
    expect([stale.status, stale.json.code]).toEqual([403, "REAUTH_REQUIRED"]);

    await signIn(browser, phone, phone.credentials[0]);
    expect((await remove(secondKey?.id)).status).toBe(200);
    const last = await remove(firstKey?.id);
    expect([last.status, last.json.code]).toEqual([400, "LAST_LOGIN_METHOD"]);
    expect((await remove("not-a-uuid")).status).toBe(404);
  }, 30_000);

  // allowUnlinkingAll 设成 true 的原因：Better Auth 只数平台绑定，会拒绝这种解绑。
  test("有通行密钥时，唯一的 Google 绑定可以解绑", async () => {
    const browser = new Browser(newApp());
    await signInWithGoogle(browser, googleProfile());
    const userId = await currentUserId(browser);
    await addPasskey(browser, new SoftAuthenticator(TEST_PUBLIC_ORIGIN, RP_ID));
    const [google] = await testDbHandle().db.select().from(account).where(eq(account.userId, userId));

    const res = await browser.request("POST", "/api/auth/unlink-account", { body: { accountId: google?.id } });

    expect(res.status).toBe(200);
    expect(await testDbHandle().db.select().from(account).where(eq(account.userId, userId))).toEqual([]);
    expect(await passkeysOf(userId)).toHaveLength(1);
  }, 30_000);

  // 改名不要求刚登录、不用人机验证，任何登录用户都能反复写：名字必须有上限。
  test("改名：超过 64 个码点、带控制字符、空白的名字被拒，库里的名字没变；首尾空白不算长度；正常名字改得成", async () => {
    const browser = new Browser(newApp());
    await signUp(browser, new SoftAuthenticator(TEST_PUBLIC_ORIGIN, RP_ID), uniqueNickname());
    const userId = await currentUserId(browser);
    const [key] = await passkeysOf(userId);
    const rename = (name: unknown) =>
      browser.request("POST", "/api/auth/passkey/update-passkey", { body: { id: key?.id, name } });
    const storedName = async () => (await passkeysOf(userId))[0]?.name;

    const fine = "我的手机".repeat(5);
    expect((await rename(fine)).status).toBe(200);
    expect(await storedName()).toBe(fine);

    const rejected: [string, unknown][] = [
      ["65 个字符", "A".repeat(65)],
      ["65 个码点", "😀".repeat(65)],
      ["控制字符", "abc\u0007def"],
      ["空白", "   "],
      ["数字", 123],
    ];
    for (const [label, name] of rejected) {
      const res = await rename(name);
      expect([res.status, res.json.code], label).toEqual([400, "PASSKEY_NAME_INVALID"]);
    }
    expect(await storedName()).toBe(fine);

    // 首尾空白会被去掉，不算长度；正好 64 个码点可以。
    expect((await rename(`${" ".repeat(100)}${"😀".repeat(64)}  `)).status).toBe(200);
    expect(await storedName()).toBe("😀".repeat(64));
  }, 30_000);

  // 传输方式只查形状（个数、长度、字符），不用白名单：规范允许浏览器以后加新的传输方式，
  // 白名单会把新浏览器的正常注册挡掉。
  test("已登录添加时 transports 只查形状：混进超长元素、超过 10 个、不是数组都拒绝，没有加上；以后新增的传输方式照常通过", async () => {
    const browser = new Browser(newApp());
    await signUp(browser, new SoftAuthenticator(TEST_PUBLIC_ORIGIN, RP_ID), uniqueNickname());
    const userId = await currentUserId(browser);
    const options = await browser.request("GET", "/api/auth/passkey/generate-register-options");
    const created = await new SoftAuthenticator(TEST_PUBLIC_ORIGIN, RP_ID).createCredential(options.json);
    const add = (transports: unknown) =>
      browser.request("POST", "/api/auth/passkey/verify-registration", {
        body: { response: { ...created, response: { ...(created.response as object), transports } } },
      });
    const rejected: [string, unknown][] = [
      ["混进一个 1000 字符的元素", ["internal", "x".repeat(1000)]],
      ["11 个元素", Array.from({ length: 11 }, (_, i) => `t${i}`)],
      ["33 个字符的元素", ["a".repeat(33)]],
      ["大写", ["Internal"]],
      ["不是字符串", [1]],
      ["不是数组", "internal"],
      ["null", null],
    ];

    // 这个钩子在插件消耗挑战之前就拒绝，所以同一份注册响应可以接着再试。
    for (const [label, transports] of rejected) {
      const res = await add(transports);
      expect([res.status, res.json.code], label).toEqual([400, "PASSKEY_RESPONSE_INVALID"]);
    }
    expect(await passkeysOf(userId)).toHaveLength(1);

    // 正好 10 个，其中一个 32 个字符，还有规范里没有的名字：形状都合法。
    const accepted = ["internal", "hybrid", "usb", "nfc", "ble", "smart-card", "quantum-link", "a".repeat(32), "x1", "y-2"];
    expect((await add(accepted)).status).toBe(200);
    expect((await passkeysOf(userId)).map((row) => row.transports)).toContain(accepted.join(","));
  }, 30_000);

  // passkey.ts 里 afterVerification 的会话检查：删掉它，其他测试都不会失败，只有这一条会。
  test("已登录时拿到注册选项，退出登录后再完成：拒绝，没有加上通行密钥", async () => {
    const browser = new Browser(newApp());
    await signUp(browser, new SoftAuthenticator(TEST_PUBLIC_ORIGIN, RP_ID), uniqueNickname());
    const userId = await currentUserId(browser);
    const options = await browser.request("GET", "/api/auth/passkey/generate-register-options");
    expect((await browser.request("POST", "/api/auth/sign-out", { body: {} })).status).toBe(200);
    expect(browser.cookies.has(SESSION_COOKIE)).toBe(false);
    const response = await new SoftAuthenticator(TEST_PUBLIC_ORIGIN, RP_ID).createCredential(options.json);

    // 挑战 Cookie 还在，只是这次请求已经没有会话了。
    const res = await browser.request("POST", "/api/auth/passkey/verify-registration", { body: { response } });

    expect([res.status, res.json.code]).toEqual([401, "REAUTH_REQUIRED"]);
    expect(await passkeysOf(userId)).toHaveLength(1);
  }, 30_000);

  // 归属检查是插件的 requireResourceOwnership：改名给出带错误码的 401，删除是不带错误码的 401。
  test("不能改名、删除别人的通行密钥（大写的 uuid 也不行），对方的通行密钥原样还在", async () => {
    const app = newApp();
    const victim = new Browser(app);
    await signUp(victim, new SoftAuthenticator(TEST_PUBLIC_ORIGIN, RP_ID), uniqueNickname());
    const victimId = await currentUserId(victim);
    const victimKeys = await passkeysOf(victimId);
    const victimKeyId = victimKeys[0]?.id ?? "";

    const attacker = new Browser(app);
    await signUp(attacker, new SoftAuthenticator(TEST_PUBLIC_ORIGIN, RP_ID), uniqueNickname());
    // 多加一个通行密钥：免得"至少留一种登录方式"先把删除挡回去，盖住归属检查。
    await addPasskey(attacker, new SoftAuthenticator(TEST_PUBLIC_ORIGIN, RP_ID));
    const attackerId = await currentUserId(attacker);
    const rename = (id: string) =>
      attacker.request("POST", "/api/auth/passkey/update-passkey", { body: { id, name: "pwned" } });
    const remove = (id: string) => attacker.request("POST", "/api/auth/passkey/delete-passkey", { body: { id } });

    const renamed = await rename(victimKeyId);
    const renamedUpper = await rename(victimKeyId.toUpperCase());
    const removed = await remove(victimKeyId);
    const removedUpper = await remove(victimKeyId.toUpperCase());

    expect([renamed.status, renamed.json.code]).toEqual([401, "YOU_ARE_NOT_ALLOWED_TO_REGISTER_THIS_PASSKEY"]);
    expect([renamedUpper.status, renamedUpper.json.code]).toEqual([401, "YOU_ARE_NOT_ALLOWED_TO_REGISTER_THIS_PASSKEY"]);
    expect(removed.status).toBe(401);
    expect(removedUpper.status).toBe(401);
    expect(await passkeysOf(victimId)).toEqual(victimKeys);
    expect(await passkeysOf(attackerId)).toHaveLength(2);
  }, 30_000);
});

describe("Bearer 会话也要过通行密钥的规则", () => {
  // before-hook 之间互相看不到彼此对 context 的改动（hook-session.ts 顶部注释）：账号规则如果直接用
  // getSessionFromCtx，纯 Bearer 请求会被误判成"没登录"，放过"会话 10 分钟内创建"的检查；
  // 之后端点自己处理请求时又认得出这个 Bearer 会话，于是旧会话照样能拿到注册选项。
  test("Bearer 添加通行密钥：刚登录时给选项，会话超过 10 分钟要求重新登录", async () => {
    const app = newApp();
    const browser = new Browser(app);
    await signUp(browser, new SoftAuthenticator(TEST_PUBLIC_ORIGIN, RP_ID), uniqueNickname());
    const userId = await currentUserId(browser);
    const token = decodeURIComponent(browser.cookies.get(SESSION_COOKIE) ?? "");
    const generate = () =>
      app.request("/api/auth/passkey/generate-register-options", { headers: { authorization: `Bearer ${token}` } });

    // 对照：会话刚创建时，同样的 Bearer 请求是拿得到选项的（所以下面的 403 只来自"不够新"）。
    expect((await generate()).status).toBe(200);

    await ageSessions(userId, 11);
    const stale = await generate();

    expect(stale.status).toBe(403);
    expect(((await stale.json()) as { code: string }).code).toBe("REAUTH_REQUIRED");
  }, 30_000);
});

describe("请求体上限", () => {
  // /api/auth/* 的请求体上限是 64 KiB（mount.ts）。凭据 id、公钥这些插件自己不检查长度的字段，
  // 靠的就是这一条。Hono 有两条路：请求头带 Content-Length 就直接比大小；没带（分块传输）就边读边数。
  test("超过 64 KiB 的请求体返回 413，不管有没有 Content-Length；在上限内的照常交给 Better Auth", async () => {
    const browser = new Browser(newApp());
    const padded = (kib: number) => ({ response: { padding: "A".repeat(kib * 1024) } });
    const post = (body: unknown, headers?: Record<string, string>) =>
      browser.request("POST", "/api/auth/passkey/verify-registration", { body, headers });

    const streamed = await post(padded(70));
    const declared = await post(padded(70), { "content-length": String(JSON.stringify(padded(70)).length) });
    const within = await post(padded(60));

    expect([streamed.status, streamed.json.code]).toEqual([413, "PAYLOAD_TOO_LARGE"]);
    expect([declared.status, declared.json.code]).toEqual([413, "PAYLOAD_TOO_LARGE"]);
    // 没有挑战 Cookie，所以 Better Auth 自己拒绝；重点是没被 413 挡掉。
    expect([within.status, within.json.code]).toEqual([400, "CHALLENGE_NOT_FOUND"]);
  }, 30_000);
});
