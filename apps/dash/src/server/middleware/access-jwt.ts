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

/** 所有拒绝路径共用同一个响应体：不能让客户端从响应里分辨出具体是哪项校验没过。 */
const REJECTED = { error: "Access 断言无效" } as const;

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
    // 所有拒绝路径都走这一个出口：对外响应体统一成 REJECTED，具体原因只写
    // 服务端日志（不含 token 本身）——运维排障需要知道拒绝原因，但持有者
    // 不该能靠响应差异探测出自己卡在哪一项校验上。
    const deny = (reason: string) => {
      console.warn(`[access-jwt] rejected: ${reason}`);
      return c.json(REJECTED, 403);
    };

    const token = c.req.header("Cf-Access-Jwt-Assertion");
    if (!token) {
      return deny("missing Cf-Access-Jwt-Assertion header");
    }

    let identity: AccessIdentity;
    try {
      // jwtVerify 自带 exp/nbf 校验；audience、issuer、algorithms 均显式传入。
      //
      // algorithms 锁定为 RS256——这是 Cloudflare Access 目前实际签发用的算法，
      // 不是装饰性限制：JWKS 里的公钥条目一旦缺了 alg 字段（现实中很常见），
      // createRemoteJWKSet/createLocalJWKSet 在结构上并不会因为算法而拒绝——
      // 同一把 RSA 公钥对 RS256/RS384/RS512/PS256 等都「可用」，真正把可信
      // 算法收窄到唯一一个的只有这一行。代价是：如果 Cloudflare 未来更换
      // 签发算法，所有请求会从那一刻起统一收到 403，而且从外部看不出原因——
      // 这是认证边界主动选择的「失败即拒绝」权衡，下一个盯着一片空白 403
      // 排查的人应该先怀疑这一行。
      const { payload } = await jwtVerify(token, getKey, {
        audience: config.aud,
        issuer: config.teamDomain,
        algorithms: ["RS256"],
      });

      const email = typeof payload.email === "string" ? payload.email.trim() : "";
      if (!email) {
        // 签名、issuer、audience、有效期全部通过，但没有 email 声明——最典型
        // 的来源是 Cloudflare Access 的 service token。这个后台只认人类
        // 管理员，所以照样拒绝；但响应必须和其它拒绝路径完全一样，否则就是
        // 告诉持有者「你就差这一项没过」。
        return deny("valid token has no email claim");
      }

      identity = { email, sub: typeof payload.sub === "string" ? payload.sub : "" };
    } catch (err) {
      // 不把 jose 的原始错误回给客户端——那会泄漏是哪一项校验失败的。
      // err.message 里不含 token 本身，可以安全打到服务端日志。
      const reason = err instanceof Error ? err.message : String(err);
      return deny(`verification failed: ${reason}`);
    }

    c.set("identity", identity);
    await next();
  });
}
