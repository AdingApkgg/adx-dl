import { beforeAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";

import { accessJwt, type AccessIdentity } from "./access-jwt";

const TEAM = "https://example.cloudflareaccess.com";
const AUD = "aud-tag-abc";

/** 造一对 RS256 密钥，返回签发函数与配套的本地 JWKS 解析器。 */
async function makeSigner() {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key";
  jwk.alg = "RS256";
  const getKey = createLocalJWKSet({ keys: [jwk] });

  const sign = async (claims: {
    aud?: string;
    iss?: string;
    email?: string;
    expiresIn?: string;
  }) => {
    let jwt = new SignJWT({ email: claims.email ?? "someone@example.com" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuedAt()
      .setSubject("user-sub-1")
      .setIssuer(claims.iss ?? TEAM)
      .setAudience(claims.aud ?? AUD);
    jwt = jwt.setExpirationTime(claims.expiresIn ?? "1h");
    return jwt.sign(privateKey);
  };

  return { sign, getKey };
}

/**
 * PS256 密钥对，只给「算法不在白名单」那一条用例用。构造上和 trusted/
 * untrusted 故意不同——JWK 里不写 alg 字段（复现现实中很常见的 JWKS
 * 形状），用来证明挡住它的是 jwtVerify 的 algorithms allowlist，而不是
 * JWKS 结构本身。不能复用 makeSigner：那边固定签 RS256、固定把 jwk.alg
 * 写死成 "RS256"，两者的“不设置 alg”前提互斥。
 */
async function makeWrongAlgSigner() {
  const { privateKey, publicKey } = await generateKeyPair("PS256", { extractable: true });
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key";
  // 故意不设置 jwk.alg。
  const getKey = createLocalJWKSet({ keys: [jwk] });
  return { privateKey, getKey };
}

/** 一个最小应用：中间件之后有一个回显身份的路由。 */
function makeApp(getKey: Awaited<ReturnType<typeof makeSigner>>["getKey"]) {
  const app = new Hono<{ Variables: { identity: AccessIdentity } }>();
  app.use("*", accessJwt({ teamDomain: TEAM, aud: AUD, getKey }));
  app.get("/whoami", (c) => c.json(c.get("identity")));
  return app;
}

// RSA 密钥生成是这个文件里最贵的操作（真实 CPU 时间，不是 I/O）——
// generateKeyPair("RS256", ...) 一次要几百毫秒。原先每条 test 各自调用
// makeSigner()，9 条测试里有 7 条其实只需要「中间件信任的那把合法密钥」，
// 却各自重新生成一遍，纯粹是重复劳动，而且是这个文件跑起来慢、在
// CPU 紧张时又容易撞上 5s 默认超时的直接原因。
//
// 这里改成按「这个文件实际要用到的、彼此不同的密钥」生成，一共 3 把，
// 每把只生成一次：
//
//   trustedKey   —— 中间件的 JWKS 认的那把，多数用例只需要它签一个
//                    token、或者只需要拿它的 getKey 起一个 app。
//   untrustedKey —— 公钥不在 JWKS 里的另一把，专门用来签出「签名对不上」
//                    的 token。这把必须和 trustedKey 是两把真正不同的
//                    密钥——如果偷懒共用同一把，"签名对不上：403" 和
//                    "两种 403 响应体一致" 这两条用例会变成用合法签名
//                    去测，测试还是绿的，但已经不再验证签名校验本身，
//                    一个真正的验签 bug 会被它们放过。
//   wrongAlgKey  —— PS256、JWK 故意不带 alg，专门用于「算法不在白名单」，
//                    见 makeWrongAlgSigner 上面的注释。
//
// 放在 beforeAll 而不是模块顶层 await：三把密钥都是异步生成的，一旦
// generateKeyPair 抛错（内存不足之类），beforeAll 会被测试框架当成
// 「这个文件的 setup hook 失败」清楚地报出来，只影响这一个文件；换成
// 模块顶层 await，抛错会变成一次 import 失败，报错更笼统，且发生在
// 测试框架自己的生命周期之外，不一定能按「这个文件的测试」被干净地
// 归因和上报。
let trustedKey: Awaited<ReturnType<typeof makeSigner>>;
let untrustedKey: Awaited<ReturnType<typeof makeSigner>>;
let wrongAlgKey: Awaited<ReturnType<typeof makeWrongAlgSigner>>;

beforeAll(async () => {
  trustedKey = await makeSigner();
  untrustedKey = await makeSigner();
  wrongAlgKey = await makeWrongAlgSigner();
});

describe("accessJwt", () => {
  test("合法断言：放行并把身份挂到 context", async () => {
    const res = await makeApp(trustedKey.getKey).request("/whoami", {
      headers: { "Cf-Access-Jwt-Assertion": await trustedKey.sign({}) },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: "someone@example.com", sub: "user-sub-1" });
  });

  test("没有断言头：403", async () => {
    const res = await makeApp(trustedKey.getKey).request("/whoami");

    expect(res.status).toBe(403);
  });

  test("签名对不上：403", async () => {
    // 用 untrustedKey 签，trustedKey 的 JWKS 里没有它的公钥。
    const res = await makeApp(trustedKey.getKey).request("/whoami", {
      headers: { "Cf-Access-Jwt-Assertion": await untrustedKey.sign({}) },
    });

    expect(res.status).toBe(403);
  });

  test("aud 不是本应用的：403", async () => {
    // 这条防的是「同一个 Cloudflare 团队下另一个应用的有效令牌」——
    // 签名是真的、团队是对的，但它不该能开这扇门。
    const res = await makeApp(trustedKey.getKey).request("/whoami", {
      headers: { "Cf-Access-Jwt-Assertion": await trustedKey.sign({ aud: "some-other-app" }) },
    });

    expect(res.status).toBe(403);
  });

  test("签发者不是本团队：403", async () => {
    const res = await makeApp(trustedKey.getKey).request("/whoami", {
      headers: {
        "Cf-Access-Jwt-Assertion": await trustedKey.sign({
          iss: "https://evil.cloudflareaccess.com",
        }),
      },
    });

    expect(res.status).toBe(403);
  });

  test("已过期：403", async () => {
    const res = await makeApp(trustedKey.getKey).request("/whoami", {
      headers: { "Cf-Access-Jwt-Assertion": await trustedKey.sign({ expiresIn: "-1h" }) },
    });

    expect(res.status).toBe(403);
  });

  test("断言里没有 email：403", async () => {
    const res = await makeApp(trustedKey.getKey).request("/whoami", {
      headers: { "Cf-Access-Jwt-Assertion": await trustedKey.sign({ email: "" }) },
    });

    expect(res.status).toBe(403);
  });

  test("校验通过但没有 email 的响应体，和签名错误的响应体完全一致（不泄漏具体卡在哪一项校验）", async () => {
    // untrustedKey 签的 token：签名对不上，trustedKey 的 JWKS 里没有它。
    const noEmailRes = await makeApp(trustedKey.getKey).request("/whoami", {
      headers: { "Cf-Access-Jwt-Assertion": await trustedKey.sign({ email: "" }) },
    });
    const badSignatureRes = await makeApp(trustedKey.getKey).request("/whoami", {
      headers: { "Cf-Access-Jwt-Assertion": await untrustedKey.sign({}) },
    });

    expect(noEmailRes.status).toBe(403);
    expect(badSignatureRes.status).toBe(403);
    // 只断言状态码相同不够——真正要验证的是响应体本身分辨不出区别。
    expect(await noEmailRes.text()).toBe(await badSignatureRes.text());
  });

  test("算法不在白名单内：403（即便 JWK 结构上本可解析该算法）", async () => {
    // 复现 Finding 2：JWK 集合里的公钥条目没有 alg 字段时（现实中很常见），
    // createLocalJWKSet/createRemoteJWKSet 在结构上并不会因为算法而拒绝——
    // 同一把 RSA 公钥对 RS256、PS256 都「可用」。裸的 alg:"none" 或对称算法
    // 伪造在这套 JWKS 下本来就会被库结构挡掉，证明不了 allowlist 起了作用；
    // wrongAlgKey 用的是 JWKS 能解析、但不在 algorithms 允许列表里的算法
    // （PS256），专门验证挡住它的是我们显式传给 jwtVerify 的 algorithms
    // 选项，而不是 JWKS 本身的结构限制。（已用实验验证：去掉 algorithms
    // 选项时，同样的请求会通过校验并返回 200——见 task-4-report.md
    // 「Fix round 1」一节。）
    const token = await new SignJWT({ email: "someone@example.com" })
      .setProtectedHeader({ alg: "PS256", kid: "test-key" })
      .setIssuedAt()
      .setSubject("user-sub-1")
      .setIssuer(TEAM)
      .setAudience(AUD)
      .setExpirationTime("1h")
      .sign(wrongAlgKey.privateKey);

    const res = await makeApp(wrongAlgKey.getKey).request("/whoami", {
      headers: { "Cf-Access-Jwt-Assertion": token },
    });

    expect(res.status).toBe(403);
  });
});
