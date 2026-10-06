import { createContext } from "react";

// 本次请求的 CSP nonce（基础 spec 第 8.2 节）。服务端入口从 requestMetaContext 取出来放进这里，和交给 <ServerRouter>
// （再由它交给 <Scripts>）的是同一个。浏览器里没有：页面上的内联脚本在 hydrate 之前就已经执行过了。
export const NonceContext = createContext<string | undefined>(undefined);
