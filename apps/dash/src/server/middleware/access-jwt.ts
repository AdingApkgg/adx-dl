import { createMiddleware } from "hono/factory";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export type AccessIdentity = {
  email: string;
  sub: string;
};

export type AccessConfig = {
  /** 团队域名，如 https://your-team.cloudflareaccess.com（末尾无斜杠）。 */
  teamDomain: string;
  /** Access 应用的 Application Audience Tag。 */
  aud: string;
  /**
   * 公钥解析器。默认去团队域名拉 JWKS；测试里注入 createLocalJWKSet，
   * 这样这个中间件不必打网络也能测。
   */
  getKey?: JWTVerifyGetKey;
};

export type AccessVariables = {
  identity: AccessIdentity;
};

/**
 * 校验 Cloudflare Access 的断言。
 *
 * 这一层不是多余的：Access 是网关防护，一旦 tunnel 配置写错、或为调试临时
 * 映射了宿主端口，后端就直接裸露——而它持有对仓库的写权限。让后端自己也
 * 验一遍，配置失误就不等于失守。
 */
export function accessJwt(config: AccessConfig) {
  const getKey =
    config.getKey ??
    createRemoteJWKSet(new URL(`${config.teamDomain}/cdn-cgi/access/certs`));

  return createMiddleware<{ Variables: AccessVariables }>(async (c, next) => {
    const token = c.req.header("Cf-Access-Jwt-Assertion");
    if (!token) {
      return c.json({ error: "缺少 Access 断言" }, 403);
    }

    let identity: AccessIdentity;
    try {
      // jwtVerify 自带 exp/nbf 校验；audience 与 issuer 显式传入。
      const { payload } = await jwtVerify(token, getKey, {
        audience: config.aud,
        issuer: config.teamDomain,
      });

      const email = typeof payload.email === "string" ? payload.email.trim() : "";
      if (!email) {
        return c.json({ error: "Access 断言里没有 email" }, 403);
      }

      identity = { email, sub: typeof payload.sub === "string" ? payload.sub : "" };
    } catch {
      // 不把 jose 的原始错误回给客户端——那会泄漏是哪一项校验失败的。
      return c.json({ error: "Access 断言无效" }, 403);
    }

    c.set("identity", identity);
    await next();
  });
}
