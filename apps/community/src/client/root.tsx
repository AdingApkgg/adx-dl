import { QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

import { getLocale } from "@/paraglide/runtime.js";
import { paraglideMiddleware } from "@/paraglide/server.js";
import { htmlLang } from "@/shared/i18n/locale";
import { makeQueryClient } from "@/shared/query-client";
import { requestMetaContext } from "@/shared/router-context";

import type { Route } from "./+types/root";
import appCss from "./app.css?url";
import { AppProviders } from "./components/app-providers";
import { ErrorCard } from "./components/error-card";
import { ThemeBootScript } from "./components/theme-boot-script";
import { getBrowserQueryClient } from "./lib/browser";

// 页面请求都在 Paraglide 的中间件里处理，之后 getLocale()、m.xxx() 用的都是这个请求的语言。
// 传 url 而不是用 request.url：站内跳转时 request.url 是 /ja.data 这样的地址，Paraglide 会认成中文。
export const middleware: Route.MiddlewareFunction[] = [
  ({ request, url }, next) => paraglideMiddleware(request, () => next(), { effectiveRequestUrl: url }),
];

// 样式表放进 <head>（spec 第 7.1 节）。?url 拿到构建后的地址：开发服务器里也是真的 <link>，不会先无样式闪一下。
export const links: Route.LinksFunction = () => [{ rel: "stylesheet", href: appCss }];

export function loader({ context }: Route.LoaderArgs) {
  const meta = context.get(requestMetaContext);
  return { requestId: meta.requestId, origin: meta.origin };
}

export function Layout({ children }: { children: ReactNode }) {
  return (
    // 防闪烁脚本在 hydrate 之前就改了 <html> 的 class 和属性，所以这一层不比对。
    <html lang={htmlLang(getLocale())} className="antialiased" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <ThemeBootScript />
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
      <AppProviders>
        <Outlet />
      </AppProviders>
    </QueryClientProvider>
  );
}

// 最后一道错误边界（spec 第 7.4 节）：根组件的 loader、中间件，以及 :lang? 布局的中间件出错时到这里，包括 /foo、
// /fr/x 这类第一段认不出语言的地址返回的 404。子页面的错误由布局的错误边界接住。这里只有出错卡片，不带页头和账号信息。
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return (
    <div className="px-4 py-16">
      <ErrorCard error={error} />
    </div>
  );
}
