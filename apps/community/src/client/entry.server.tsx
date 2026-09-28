import { isbot } from "isbot";
// 必须是 .edge：react-router-hono-server 在 Bun 下把 react-dom/server 换成 .browser，
// 而 .browser 流式渲染时会丢掉 AsyncLocalStorage，晚到的 Suspense 内容会变成中文（Task 10）。
import { renderToReadableStream } from "react-dom/server.edge";
import type { EntryContext, HandleErrorFunction, RouterContextProvider } from "react-router";
import { isRouteErrorResponse, ServerRouter } from "react-router";

import { describeError } from "@/shared/describe-error";
import { createLogger, type Logger } from "@/shared/log";
import { requestMetaContext } from "@/shared/router-context";

export const streamTimeout = 5_000;

const log = createLogger();

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
        // 外壳之前的错误会从 renderToReadableStream 抛出去，由 React Router 交给
        // handleError；外壳之后响应已经发出，只能在这里记。
        if (shellRendered) {
          reportSsrError(log, error, { request, context: loadContext });
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

// loader 出错、渲染外壳出错时 React Router 调它。不导出的话，React Router 会把多行的
// 错误栈直接打到 stderr，绕开单行 JSON 日志。
export const handleError: HandleErrorFunction = (error, { request, context }) => {
  reportSsrError(log, error, { request, context });
};

// 页面请求出错时写一行 JSON 日志，和服务端其他日志同一个格式；只记路径，不记查询串。
export function reportSsrError(
  logger: Logger,
  error: unknown,
  { request, context }: { request: Request; context: Readonly<RouterContextProvider> | undefined }
): void {
  // 访客关掉或离开页面时请求被中止，这不算错误（React Router 默认也不记）。
  if (request.signal.aborted) {
    return;
  }
  // React Router 自己产生的 404、405 把真正的错误包在 .error 里，默认的处理记的也是它。
  const routeError = isRouteErrorResponse(error) ? error : undefined;
  const inner = (routeError as { error?: unknown } | undefined)?.error;
  logger.error("ssr_error", {
    requestId: requestIdOf(context),
    method: request.method,
    path: new URL(request.url).pathname,
    status: routeError?.status,
    ...describeError(inner ?? error),
  });
}

// React Router 在建好请求上下文之前出错时 context 是 undefined；上下文里没有这一项时
// get() 会抛错。这里不能抛：handleError 抛出的错误会盖掉原来那个。
function requestIdOf(context: Readonly<RouterContextProvider> | undefined): string | undefined {
  try {
    return context?.get(requestMetaContext).requestId;
  } catch {
    return undefined;
  }
}
