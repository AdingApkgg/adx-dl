import { afterAll, describe, expect, test } from "bun:test";

import { createLogger } from "@/shared/log";

import { startFakeOneBot } from "../testing/fake-onebot";
import { createOneBotClient } from "./client";
import { createNapcatSender } from "./sender";

const TOKEN = "napcat-token-napcat-token-0123456789";
const napcat = startFakeOneBot({ accessToken: TOKEN });
const lines: string[] = [];
const sender = createNapcatSender(
  createOneBotClient({ httpUrl: napcat.httpUrl, accessToken: TOKEN }),
  createLogger((line) => lines.push(line))
);

afterAll(() => {
  napcat.stop();
});

describe("NapCat 发送器", () => {
  test("按语言私聊发验证码", async () => {
    napcat.handle("send_private_msg", () => ({ message_id: 1 }));

    await sender.sendCode("10001", "123456", "ja");

    const params = napcat.calls.at(-1)?.params;
    expect(params?.user_id).toBe("10001");
    expect(String(params?.message)).toContain("ログイン認証コード：123456");
  });

  test("发送失败时抛错（由 QQ 插件在后台记日志）", async () => {
    napcat.handle("send_private_msg", () => {
      throw new Error("Timeout");
    });

    await expect(sender.sendCode("10001", "123456", "zh")).rejects.toThrow();
  });

  test("查昵称：规整后返回；查不到返回 null 并记日志，日志里没有 QQ 号", async () => {
    napcat.handle("get_stranger_info", () => ({ nickname: "  小马哥\u0007 " }));
    expect(await sender.lookupNickname("10001")).toBe("小马哥");

    napcat.handle("get_stranger_info", () => {
      throw new Error("user 10002 not found");
    });
    expect(await sender.lookupNickname("10002")).toBeNull();
    expect(lines.some((line) => line.includes("napcat_lookup_failed") && !line.includes("10002"))).toBe(true);
  });
});
