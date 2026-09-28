import { QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRevalidator,
  useRouteLoaderData,
} from "react-router";

import { m } from "@/paraglide/messages.js";
import { getLocale } from "@/paraglide/runtime.js";
import { paraglideMiddleware } from "@/paraglide/server.js";
import { htmlLang } from "@/shared/i18n/locale";
import { makeQueryClient } from "@/shared/query-client";
import { requestMetaContext } from "@/shared/router-context";

import type { Route } from "./+types/root";
import { getBrowserQueryClient } from "./lib/browser";

// 页面请求都在 Paraglide 的中间件里处理，之后 getLocale()、m.xxx() 用的都是这个请求的语言。
// 传 url 而不是用 request.url：站内跳转时 request.url 是 /ja.data 这样的地址，Paraglide 会认成中文。
export const middleware: Route.MiddlewareFunction[] = [
  ({ request, url }, next) => paraglideMiddleware(request, () => next(), { effectiveRequestUrl: url }),
];

export function loader({ context }: Route.LoaderArgs) {
  const meta = context.get(requestMetaContext);
  return { requestId: meta.requestId, origin: meta.origin };
}

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang={htmlLang(getLocale())}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  // 服务端每次渲染新建一个（请求之间不能共享缓存）；浏览器里用同一个单例。
  const [queryClient] = useState(() => (typeof window === "undefined" ? makeQueryClient() : getBrowserQueryClient()));
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  // 这是这次页面加载时服务端渲染那个请求的 ID。站内跳转出错时它指向的是最初那次请求，
  // 排查时按它找到访客和时间，再看前后的日志。
  const requestId = useRouteLoaderData<typeof loader>("root")?.requestId;
  const revalidator = useRevalidator();

  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <main>
        <h1>{m.error_not_found_title()}</h1>
        <p>{m.error_not_found_body()}</p>
      </main>
    );
  }

  return (
    <main>
      <h1>{m.error_server_title()}</h1>
      <p>{m.error_server_body()}</p>
      {requestId ? (
        <p>
          {m.error_request_id()}: <code>{requestId}</code>
        </p>
      ) : null}
      {/* 站内跳转时断网也会落到这里（spec 第 11.4 节）：重新执行当前页面的 loader，成功就恢复正常页面。 */}
      <button type="button" disabled={revalidator.state === "loading"} onClick={() => revalidator.revalidate()}>
        {m.error_retry()}
      </button>
    </main>
  );
}
