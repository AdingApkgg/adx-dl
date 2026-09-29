import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/client";

import { qqLoginClient } from "./qq-client";

// 只用来执行动作（登录、绑定、解绑、通行密钥、退出）；当前用户由 TanStack Query 从 /api/v1/me 读。
// 构造时不访问 window，模块顶层创建是安全的；但它的方法只能在浏览器的事件处理函数里调用
// （服务端没有相对地址可以请求）。
export const authClient = createAuthClient({ plugins: [passkeyClient(), qqLoginClient()] });
