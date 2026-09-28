import { describe, expect, test } from "bun:test";

import { parseEnv } from "./env";

const SECRET = "0123456789abcdef0123456789abcdef";

const complete = {
  PUBLIC_ORIGIN: "https://community.example.com",
  DATABASE_URL: "postgres://community:secret@db:5432/community",
  REDIS_URL: "redis://redis:6379",
  BETTER_AUTH_SECRET: SECRET,
  GOOGLE_CLIENT_ID: "google-id",
  GOOGLE_CLIENT_SECRET: "google-secret",
  TURNSTILE_SITE_KEY: "site-key",
  TURNSTILE_SECRET_KEY: "turnstile-secret",
  QQ_SENDER: "console",
  QQ_CODE_HMAC_KEY: SECRET,
};

const napcat = {
  QQ_SENDER: "napcat",
  NAPCAT_HTTP_URL: "http://napcat:3000",
  NAPCAT_WS_URL: "ws://napcat:3001",
  NAPCAT_ACCESS_TOKEN: SECRET,
  NAPCAT_BOT_QQ: "10001",
};

function without(source: Record<string, string>, key: string): Record<string, string> {
  return Object.fromEntries(Object.entries(source).filter(([name]) => name !== key));
}

describe("parseEnv", () => {
  test("解析完整配置，并填上默认值", () => {
    expect(parseEnv(complete)).toEqual({
      nodeEnv: "development",
      port: 3000,
      host: "127.0.0.1",
      publicOrigin: "https://community.example.com",
      databaseUrl: "postgres://community:secret@db:5432/community",
      redisUrl: "redis://redis:6379",
      betterAuthSecret: SECRET,
      google: { clientId: "google-id", clientSecret: "google-secret" },
      turnstile: { siteKey: "site-key", secretKey: "turnstile-secret" },
      qqCodeHmacKey: SECRET,
      qq: { sender: "console" },
    });
  });

  test("缺项时一次报全", () => {
    try {
      parseEnv({});
      throw new Error("应当抛错");
    } catch (error) {
      const message = (error as Error).message;
      for (const key of [
        "PUBLIC_ORIGIN",
        "DATABASE_URL",
        "REDIS_URL",
        "BETTER_AUTH_SECRET",
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "TURNSTILE_SITE_KEY",
        "TURNSTILE_SECRET_KEY",
        "QQ_SENDER",
        "QQ_CODE_HMAC_KEY",
      ]) {
        expect(message).toContain(`${key} 未设置`);
      }
    }
  });

  test("PUBLIC_ORIGIN 末尾的斜杠会被去掉", () => {
    expect(parseEnv({ ...complete, PUBLIC_ORIGIN: "https://community.example.com/" }).publicOrigin).toBe(
      "https://community.example.com"
    );
  });

  // CSRF 校验拿它和请求的 Origin 头做字符串比较。Origin 永远是 scheme://host[:port]，
  // 格式不对就永远不相等，等于悄悄关掉了防护，所以启动时就要拦下。
  test("PUBLIC_ORIGIN 缺 scheme 或带路径时报错", () => {
    expect(() => parseEnv({ ...complete, PUBLIC_ORIGIN: "community.example.com" })).toThrow(/PUBLIC_ORIGIN/);
    expect(() => parseEnv({ ...complete, PUBLIC_ORIGIN: "https://community.example.com/app" })).toThrow(
      /PUBLIC_ORIGIN/
    );
  });

  // 浏览器发来的 Origin 是规范写法；不一致时 CSRF 校验永远不通过，canonical、hreflang
  // 拼出来的地址也是坏的。
  test("PUBLIC_ORIGIN 必须是规范写法：主机名小写、不写默认端口、不带查询串", () => {
    for (const value of ["https://x.com?a", "https://X.com", "https://x.com:443", "https://user@x.com"]) {
      expect(() => parseEnv({ ...complete, PUBLIC_ORIGIN: value }), value).toThrow(/PUBLIC_ORIGIN/);
    }
    expect(parseEnv({ ...complete, PUBLIC_ORIGIN: "http://127.0.0.1:3000" }).publicOrigin).toBe(
      "http://127.0.0.1:3000"
    );
  });

  test("数据库和 Redis 地址必须是对应的协议", () => {
    expect(() => parseEnv({ ...complete, DATABASE_URL: "mysql://x" })).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ ...complete, REDIS_URL: "http://x" })).toThrow(/REDIS_URL/);
  });

  test("端口可以覆盖，不是整数时报错", () => {
    expect(parseEnv({ ...complete, PORT: "8080" }).port).toBe(8080);
    expect(() => parseEnv({ ...complete, PORT: "abc" })).toThrow(/PORT/);
  });

  test("去掉 compose env_file 可能保留的引号", () => {
    expect(parseEnv({ ...complete, REDIS_URL: '"redis://redis:6379"' }).redisUrl).toBe("redis://redis:6379");
  });

  test("密钥少于 32 个字符时报错", () => {
    expect(() => parseEnv({ ...complete, BETTER_AUTH_SECRET: "short" })).toThrow(/BETTER_AUTH_SECRET/);
    expect(() => parseEnv({ ...complete, QQ_CODE_HMAC_KEY: "short" })).toThrow(/QQ_CODE_HMAC_KEY/);
  });

  test("QQ_SENDER 只能是 napcat 或 console", () => {
    expect(() => parseEnv({ ...complete, QQ_SENDER: "sms" })).toThrow(/QQ_SENDER/);
  });

  test("QQ_SENDER=napcat 时解析机器人配置", () => {
    expect(parseEnv({ ...complete, ...napcat }).qq).toEqual({
      sender: "napcat",
      httpUrl: "http://napcat:3000",
      wsUrl: "ws://napcat:3001",
      accessToken: SECRET,
      botQq: "10001",
    });
  });

  test("QQ_SENDER=napcat 时机器人配置缺一项就报错", () => {
    expect(() => parseEnv({ ...complete, ...without(napcat, "NAPCAT_WS_URL") })).toThrow(/NAPCAT_WS_URL 未设置/);
  });

  // NapCat 的访问令牌留空等于关掉它的鉴权（调研报告第 2.1 节），所以和密钥一样要求长度。
  test("NapCat 访问令牌太短、机器人 QQ 号格式不对时报错", () => {
    expect(() => parseEnv({ ...complete, ...napcat, NAPCAT_ACCESS_TOKEN: "x" })).toThrow(/NAPCAT_ACCESS_TOKEN/);
    expect(() => parseEnv({ ...complete, ...napcat, NAPCAT_BOT_QQ: "0123" })).toThrow(/NAPCAT_BOT_QQ/);
  });

  test("生产环境不能用控制台发送器", () => {
    expect(() => parseEnv({ ...complete, NODE_ENV: "production" })).toThrow(/QQ_SENDER/);
    expect(parseEnv({ ...complete, ...napcat, NODE_ENV: "production" }).qq.sender).toBe("napcat");
  });
});
