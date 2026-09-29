import { describe, expect, test } from "bun:test";

import type { RedisCommandSender } from "../middleware/rate-limit";
import { createLoginOptions } from "./login-options";

function fakeRedis(value: string | null): RedisCommandSender {
  return { send: async () => value };
}

const napcat = {
  sender: "napcat",
  httpUrl: "http://napcat:3000",
  wsUrl: "ws://napcat:3001",
  accessToken: "token",
  botQq: "10001",
} as const;

describe("createLoginOptions", () => {
  test("控制台发送器：QQ 总是可用，不显示机器人号", async () => {
    const options = createLoginOptions({ turnstileSiteKey: "site", qq: { sender: "console" }, redis: fakeRedis(null) });
    expect(await options()).toEqual({ turnstileSiteKey: "site", qq: { available: true, botQq: null } });
  });

  test("NapCat：按 worker 写的状态决定是否可用；没有记录时当作可用", async () => {
    const run = (value: string | null) => createLoginOptions({ turnstileSiteKey: "site", qq: napcat, redis: fakeRedis(value) })();

    expect((await run(JSON.stringify({ state: "online" }))).qq).toEqual({ available: true, botQq: "10001" });
    expect((await run(JSON.stringify({ state: "offline" }))).qq.available).toBe(false);
    expect((await run(JSON.stringify({ state: "unreachable" }))).qq.available).toBe(false);
    expect((await run(null)).qq.available).toBe(true);
  });

  test("Redis 出错时也当作可用", async () => {
    const broken: RedisCommandSender = {
      send: async () => {
        throw new Error("Connection closed");
      },
    };
    const options = createLoginOptions({ turnstileSiteKey: "site", qq: napcat, redis: broken });
    expect((await options()).qq.available).toBe(true);
  });
});
