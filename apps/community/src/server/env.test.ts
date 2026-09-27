import { describe, expect, test } from "bun:test";

import { parseEnv } from "./env";

const complete = {
  PUBLIC_ORIGIN: "https://community.example.com",
  DATABASE_URL: "postgres://community:secret@db:5432/community",
  REDIS_URL: "redis://redis:6379",
};

describe("parseEnv", () => {
  test("解析完整配置，并填上默认值", () => {
    expect(parseEnv(complete)).toEqual({
      nodeEnv: "development",
      port: 3000,
      host: "127.0.0.1",
      publicOrigin: "https://community.example.com",
      databaseUrl: "postgres://community:secret@db:5432/community",
      redisUrl: "redis://redis:6379",
    });
  });

  test("缺项时一次报全", () => {
    try {
      parseEnv({});
      throw new Error("应当抛错");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("PUBLIC_ORIGIN 未设置");
      expect(message).toContain("DATABASE_URL 未设置");
      expect(message).toContain("REDIS_URL 未设置");
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
});
