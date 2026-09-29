import { describe, expect, test } from "bun:test";

import { createConsoleSender, maskQq, qqCodeMessage } from "./sender";

describe("QQ 发送器", () => {
  test("验证码消息按语言生成，带着验证码", () => {
    expect(qqCodeMessage("123456", "zh")).toContain("登录验证码：123456");
    expect(qqCodeMessage("123456", "en")).toContain("123456");
    expect(qqCodeMessage("123456", "ja")).toContain("123456");
  });

  test("控制台发送器把消息打印出来，查不到昵称", async () => {
    const lines: string[] = [];
    const sender = createConsoleSender((line) => lines.push(line));

    await sender.sendCode("10001", "123456", "zh");

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("10001");
    expect(lines[0]).toContain("123456");
    expect(await sender.lookupNickname("10001")).toBeNull();
  });

  test("QQ 号打码只留前两位和后两位", () => {
    expect(maskQq("123456789")).toBe("12****89");
    expect(maskQq("10001")).toBe("10****01");
  });
});
