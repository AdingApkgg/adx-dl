import { isbot } from "isbot";
// 必须是 .edge：react-router-hono-server 在 Bun 下把 react-dom/server 换成 .browser，
// 而 .browser 流式渲染时会丢掉 AsyncLocalStorage，晚到的 Suspense 内容会变成中文（Task 10）。
import { renderToReadableStream } from "react-dom/server.edge";
import type { EntryContext, RouterContextProvider } from "react-router";
import { ServerRouter } from "react-router";

import { requestMetaContext } from "@/shared/router-context";

export const streamTimeout = 5_000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  loadContext: RouterContextProvider
) {
  // 页面一律不让 Cloudflare 缓存：它按扩展名缓存，有人能构造 /settings/x.jpg 这样的
  // 地址骗它缓存带登录态的页面（spec 第 8.2 节）。
  responseHeaders.set("Cache-Control", "private, no-store");

  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, { status: responseStatusCode, headers: responseHeaders });
  }

  // ServerRouter 的 nonce 会传给 <Scripts>、<ScrollRestoration>、流式数据的脚本；
  // renderToReadableStream 的 nonce 给 React 自己插入的脚本。
  const { nonce } = loadContext.get(requestMetaContext);
  let shellRendered = false;
  const userAgent = request.headers.get("user-agent");

  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} nonce={nonce} />,
    {
      nonce,
      signal: AbortSignal.timeout(streamTimeout + 1000),
      onError(error: unknown) {
        responseStatusCode = 500;
        if (shellRendered) {
          console.error(error);
        }
      },
    }
  );
  shellRendered = true;

  if ((userAgent && isbot(userAgent)) || routerContext.isSpaMode) {
    await body.allReady;
  }

  responseHeaders.set("Content-Type", "text/html; charset=utf-8");
  return new Response(body, { headers: responseHeaders, status: responseStatusCode });
}

// 站内切换页面时浏览器请求的 .data 响应，同样不缓存。
export function handleDataRequest(response: Response) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
