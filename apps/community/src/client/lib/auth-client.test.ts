import { describe, expect, test } from "bun:test";

import { m } from "@/paraglide/messages.js";

import { createCommunityAuthClient } from "./auth-client";
import { errorMessage } from "./auth-errors";

// 9 号端口没有程序监听，连接会被立刻拒绝（HTTP 测试里的 NapCat 地址也用它）。
const client = createCommunityAuthClient("http://127.0.0.1:9");

// 页面上用到 authClient 的每个入口：qq 两个和 signIn.social 走 Better Auth 的动态路径代理，
// 通行密钥的两个是插件自己的动作，取选项的请求各自直接调用 $fetch。
const CALLS = {
  "qq.sendCode": () => client.qq.sendCode({ qq: "10001", turnstileToken: "x" }),
  "qq.verify": () => client.qq.verify({ qq: "10001", code: "123456", intent: "login" }),
  "signIn.social": () => client.signIn.social({ provider: "google", callbackURL: "/" }),
  "signIn.passkey": () => client.signIn.passkey(),
  "passkey.addPasskey": () => client.passkey.addPasskey({ context: "{}", createSession: true }),
};

// 网络出错（断网、服务器没响应）时 authClient 的方法必须照常 resolve 成 { error }，而不是 reject：
// 处理函数里 setPending(false)、turnstile.reset() 都在 await 之后，reject 会让按钮永远停在禁用或"处理中…"。
describe("createCommunityAuthClient：连不上服务器", () => {
  for (const [name, call] of Object.entries(CALLS)) {
    test(`${name} 不抛出：data 是 null，error 翻成通用文案`, async () => {
      const res = await call();

      expect(res.data).toBeNull();
      expect(res.error).not.toBeNull();
      expect(res.error?.status).toBe(500);
      expect(errorMessage(res.error)).toBe(m.error_unknown());
    });
  }
});
