import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/client";

import { qqLoginClient } from "./qq-client";

type FetchOptions = NonNullable<Parameters<typeof createAuthClient>[0]>["fetchOptions"];

// baseURL 只有测试要传：指向一个连不上的端口，验证网络出错时的行为。浏览器里不传，用当前页面的来源。
export function createCommunityAuthClient(baseURL?: string) {
  return createAuthClient({
    baseURL,
    plugins: [passkeyClient(), qqLoginClient()],
    // 默认情况下网络出错（断网、服务器没响应）时 authClient 的方法会 reject，而不是返回 { error }；
    // 页面上处理函数里的 setPending(false)、turnstile.reset() 都在 await 之后，按钮就会一直停在禁用或"处理中…"。
    // 打开 catchAllError 后网络错误也变成 { data: null, error: { status: 500 } }：errorMessage 翻成通用文案，按钮能恢复。
    // catchAllError 是 better-fetch createFetch 的选项，Better Auth 的 fetchOptions 类型（ClientFetchOption）没有列出它，
    // 但它会把整个 fetchOptions 交给 createFetch，运行时是生效的，所以断言只放在这一个字段上。
    // 不能省：直接写对象字面量会过不了类型检查，推断退回基础类型，authClient 上的 qq、passkey 也就都没有类型了。
    fetchOptions: { catchAllError: true } as FetchOptions,
  });
}

// 只用来执行动作（登录、绑定、解绑、通行密钥、退出）；当前用户由 TanStack Query 从 /api/v1/me 读。
// 构造时不访问 window，模块顶层创建是安全的；但它的方法只能在浏览器的事件处理函数里调用
// （服务端没有相对地址可以请求）。
export const authClient = createCommunityAuthClient();
