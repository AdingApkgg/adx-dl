import type { QueryClient } from "@tanstack/react-query";
import { createContext } from "react-router";

import type { ApiClient } from "./api-client";

export type RequestMeta = {
  requestId: string;
  /** CSP nonce，由 hono/secure-headers 为每个请求生成。 */
  nonce: string | undefined;
  /** 站点对外地址（PUBLIC_ORIGIN），拼 canonical 和 hreflang 用。 */
  origin: string;
};

// 服务端入口的 getLoadContext 负责给这三个上下文赋值，每个请求一份。
// 没有默认值：漏赋值时 context.get() 会直接报错，而不是悄悄拿到 undefined。
export const requestMetaContext = createContext<RequestMeta>();
export const apiContext = createContext<ApiClient>();
export const queryClientContext = createContext<QueryClient>();
