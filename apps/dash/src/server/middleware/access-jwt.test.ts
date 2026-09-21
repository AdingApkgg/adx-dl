import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";

import { accessJwt, type AccessIdentity } from "./access-jwt";

const TEAM = "https://example.cloudflareaccess.com";
const AUD = "aud-tag-abc";

/** 造一对密钥，返回签发函数与配套的本地 JWKS 解析器。 */
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

/** 一个最小应用：中间件之后有一个回显身份的路由。 */
function makeApp(getKey: Awaited<ReturnType<typeof makeSigner>>["getKey"]) {
  const app = new Hono<{ Variables: { identity: AccessIdentity } }>();
  app.use("*", accessJwt({ teamDomain: TEAM, aud: AUD, getKey }));
  app.get("/whoami", (c) => c.json(c.get("identity")));
  return app;
}

describe("accessJwt", () => {
  test("合法断言：放行并把身份挂到 context", async () => {
    const { sign, getKey } = await makeSigner();
    const res = await makeApp(getKey).request("/whoami", {
      headers: { "Cf-Access-Jwt-Assertion": await sign({}) },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: "someone@example.com", sub: "user-sub-1" });
  });

  test("没有断言头：403", async () => {
    const { getKey } = await makeSigner();
    const res = await makeApp(getKey).request("/whoami");

    expect(res.status).toBe(403);
  });

  test("签名对不上：403", async () => {
    const { getKey } = await makeSigner();
    // 用另一对密钥签，公钥集里没有它。
    const other = await makeSigner();
    const res = await makeApp(getKey).request("/whoami", {
      headers: { "Cf-Access-Jwt-Assertion": await other.sign({}) },
    });

    expect(res.status).toBe(403);
  });

  test("aud 不是本应用的：403", async () => {
    // 这条防的是「同一个 Cloudflare 团队下另一个应用的有效令牌」——
    // 签名是真的、团队是对的，但它不该能开这扇门。
    const { sign, getKey } = await makeSigner();
    const res = await makeApp(getKey).request("/whoami", {
      headers: { "Cf-Access-Jwt-Assertion": await sign({ aud: "some-other-app" }) },
    });

    expect(res.status).toBe(403);
  });

  test("签发者不是本团队：403", async () => {
    const { sign, getKey } = await makeSigner();
    const res = await makeApp(getKey).request("/whoami", {
      headers: { "Cf-Access-Jwt-Assertion": await sign({ iss: "https://evil.cloudflareaccess.com" }) },
    });

    expect(res.status).toBe(403);
  });

  test("已过期：403", async () => {
    const { sign, getKey } = await makeSigner();
    const res = await makeApp(getKey).request("/whoami", {
      headers: { "Cf-Access-Jwt-Assertion": await sign({ expiresIn: "-1h" }) },
    });

    expect(res.status).toBe(403);
  });

  test("断言里没有 email：403", async () => {
    const { sign, getKey } = await makeSigner();
    const res = await makeApp(getKey).request("/whoami", {
      headers: { "Cf-Access-Jwt-Assertion": await sign({ email: "" }) },
    });

    expect(res.status).toBe(403);
  });

  test("校验通过但没有 email 的响应体，和签名错误的响应体完全一致（不泄漏具体卡在哪一项校验）", async () => {
    const { sign, getKey } = await makeSigner();
    // 另一对密钥签的 token：签名对不上，公钥集里没有它。
    const other = await makeSigner();

    const noEmailRes = await makeApp(getKey).request("/whoami", {
      headers: { "Cf-Access-Jwt-Assertion": await sign({ email: "" }) },
    });
    const badSignatureRes = await makeApp(getKey).request("/whoami", {
      headers: { "Cf-Access-Jwt-Assertion": await other.sign({}) },
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
    // 这里改用 JWKS 能解析、但不在 algorithms 允许列表里的算法（PS256），
    // 专门验证挡住它的是我们显式传给 jwtVerify 的 algorithms 选项，而不是
    // JWKS 本身的结构限制。（已用实验验证：去掉 algorithms 选项时，同样的
    // 请求会通过校验并返回 200——见 task-4-report.md「Fix round 1」一节。）
    const { privateKey, publicKey } = await generateKeyPair("PS256", { extractable: true });
    const jwk = await exportJWK(publicKey);
    jwk.kid = "test-key";
    // 故意不设置 jwk.alg。
    const getKey = createLocalJWKSet({ keys: [jwk] });

    const token = await new SignJWT({ email: "someone@example.com" })
      .setProtectedHeader({ alg: "PS256", kid: "test-key" })
      .setIssuedAt()
      .setSubject("user-sub-1")
      .setIssuer(TEAM)
      .setAudience(AUD)
      .setExpirationTime("1h")
      .sign(privateKey);

    const res = await makeApp(getKey).request("/whoami", {
      headers: { "Cf-Access-Jwt-Assertion": token },
    });

    expect(res.status).toBe(403);
  });
});
