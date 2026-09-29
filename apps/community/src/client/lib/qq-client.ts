import type { BetterAuthClientPlugin } from "better-auth/client";

import type { QqLoginPlugin } from "@/server/auth/auth-type";

// QQ 登录插件的客户端部分：只为了让 authClient.qq.sendCode / verify 有类型。
export const qqLoginClient = () =>
  ({
    id: "qq-login",
    $InferServerPlugin: {} as QqLoginPlugin,
    // 验证成功会建立会话，通知 Better Auth 客户端刷新它自己的会话状态。
    atomListeners: [{ matcher: (path) => path === "/qq/verify", signal: "$sessionSignal" }],
  }) satisfies BetterAuthClientPlugin;
