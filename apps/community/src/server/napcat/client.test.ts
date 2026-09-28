import { afterAll, describe, expect, test } from "bun:test";

import { startFakeOneBot } from "../testing/fake-onebot";
import { createOneBotClient, OneBotError } from "./client";

const TOKEN = "napcat-token-napcat-token-0123456789";
const napcat = startFakeOneBot({ accessToken: TOKEN });
const client = createOneBotClient({ httpUrl: napcat.httpUrl, accessToken: TOKEN });

afterAll(() => {
  napcat.stop();
});

describe("OneBot 客户端", () => {
  test("POST JSON 到 /<action>，带 Bearer 令牌，返回 data", async () => {
    napcat.handle("get_status", () => ({ online: true, good: true, stat: {} }));

    expect(await client.getStatus()).toEqual({ online: true, good: true });
    expect(napcat.calls.at(-1)).toEqual({ action: "get_status", params: {}, authorization: `Bearer ${TOKEN}` });
  });

  test("私聊发消息：user_id 和纯文本 message", async () => {
    napcat.handle("send_private_msg", () => ({ message_id: 1 }));

    await client.sendPrivateMsg("10001", "你好");

    expect(napcat.calls.at(-1)?.params).toEqual({ user_id: "10001", message: "你好" });
  });

  test("查陌生人信息取 nickname", async () => {
    napcat.handle("get_stranger_info", (params) => ({ user_id: Number(params.user_id), nickname: "小马哥" }));

    expect(await client.getStrangerInfo("10001")).toEqual({ nickname: "小马哥" });
  });

  // NapCat 的失败是 HTTP 200 + status: "failed"（调研报告第 2.1 节）。
  test("status 不是 ok 时抛 OneBotError，错误信息里不带 NapCat 的原话", async () => {
    napcat.handle("set_friend_add_request", () => {
      throw new Error("No such request for 10001");
    });

    const error = await client.setFriendAddRequest("flag-1", true).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OneBotError);
    expect(error).toMatchObject({ action: "set_friend_add_request", retcode: 200 });
    expect(String((error as Error).message)).not.toContain("10001");
  });

  test("超时抛错", async () => {
    napcat.handle("get_status", async () => {
      await Bun.sleep(300);
      return { online: true, good: true };
    });

    await expect(client.getStatus({ timeoutMs: 50 })).rejects.toThrow();
  });
});
