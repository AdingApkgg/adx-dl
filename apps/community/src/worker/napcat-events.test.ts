import { afterAll, describe, expect, test } from "bun:test";

import { startFakeOneBot, waitFor } from "@/server/testing/fake-onebot";
import { createLogger } from "@/shared/log";

import { startNapcatEvents } from "./napcat-events";

const TOKEN = "napcat-token-napcat-token-0123456789";
const napcat = startFakeOneBot({ accessToken: TOKEN });
const log = createLogger(() => {});

afterAll(() => {
  napcat.stop();
});

describe("NapCat 事件", () => {
  test("连根路径、令牌放查询参数；收到加好友申请就调用 onFriendRequest", async () => {
    const flags: string[] = [];
    const events = startNapcatEvents({
      wsUrl: napcat.wsUrl,
      accessToken: TOKEN,
      log,
      onFriendRequest: async (flag) => {
        flags.push(flag);
      },
    });
    try {
      await waitFor(() => events.connected());
      expect(napcat.upgradePaths.at(-1)).toBe("/");

      napcat.push({ post_type: "meta_event", meta_event_type: "heartbeat", status: { online: true, good: true } });
      napcat.push({ post_type: "request", request_type: "friend", user_id: 10001, comment: "你好", flag: "1758960000123" });

      await waitFor(() => flags.length === 1);
      expect(flags).toEqual(["1758960000123"]);
    } finally {
      events.stop();
    }
  });

  test("断线后自动重连", async () => {
    const before = napcat.connections();
    const events = startNapcatEvents({
      wsUrl: napcat.wsUrl,
      accessToken: TOKEN,
      log,
      onFriendRequest: async () => {},
      initialBackoffMs: 20,
    });
    try {
      await waitFor(() => events.connected());
      napcat.dropConnections();
      await waitFor(() => napcat.connections() >= before + 2);
      await waitFor(() => events.connected());
    } finally {
      events.stop();
    }
  });

  // 半开的 TCP 连接可能很久才被发现；NapCat 默认每 30 秒一次心跳，太久没消息就当作断了。
  test("太久没有收到任何消息时主动断开重连", async () => {
    const before = napcat.connections();
    const events = startNapcatEvents({
      wsUrl: napcat.wsUrl,
      accessToken: TOKEN,
      log,
      onFriendRequest: async () => {},
      idleTimeoutMs: 100,
      initialBackoffMs: 20,
    });
    try {
      await waitFor(() => napcat.connections() >= before + 2);
    } finally {
      events.stop();
    }
  });
});
