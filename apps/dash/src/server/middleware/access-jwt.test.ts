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
});
