import { QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteLoaderData } from "react-router";

import { getLocale } from "@/paraglide/runtime.js";
import { paraglideMiddleware } from "@/paraglide/server.js";
import { htmlLang } from "@/shared/i18n/locale";
import { makeQueryClient } from "@/shared/query-client";
import { requestMetaContext } from "@/shared/router-context";

import type { Route } from "./+types/root";
import appCss from "./app.css?url";
import { AppProviders } from "./components/app-providers";
import { ErrorCard } from "./components/error-card";
import { LoginEvent } from "./components/login-event";
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
  return {
    requestId: meta.requestId,
    origin: meta.origin,
    // 统计（spec 第 11.6 节）：没设 UMAMI_WEBSITE_ID 时是 null，页面里不放脚本。
    analytics: meta.umamiWebsiteId ? { websiteId: meta.umamiWebsiteId, domain: new URL(meta.origin).hostname } : null,
  };
}

export function Layout({ children }: { children: ReactNode }) {
  // 出错页面也用这个 Layout：那时可能拿不到根组件的 loader 数据。
  const analytics = useRouteLoaderData<typeof loader>("root")?.analytics;
  return (
    // 防闪烁脚本在 hydrate 之前就改了 <html> 的 class 和属性，所以这一层不比对。
    <html lang={htmlLang(getLocale())} className="antialiased" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <ThemeBootScript />
        <Meta />
        {/* nonce 故意给空的：不传的话 React Router 会把这次请求的 nonce 抄到样式表的 <link> 上，浏览器里拿不到
            这个值，hydrate 时报属性对不上。CSP 的 style-src 不用 nonce，空值没有影响；脚本照样由 <Scripts> 和
            ThemeBootScript 带上真的 nonce。 */}
        <Links nonce="" />
        {/* Umami 的统计脚本走本站的 /_s/（Hono 转发，CSP 的 'self' 就放行）。data-host-url 让上报发到 /_s/api/send。
            不记查询串和 # 后面的内容（data-exclude-*），只在本站的域名上记（data-domains）。defer：排在 React Router
            的模块脚本前面执行，hydrate 之后 window.umami 已经在了（LoginEvent 要用）。 */}
        {analytics ? (
          <script
            defer
            src="/_s/script.js"
            data-website-id={analytics.websiteId}
            data-host-url="/_s"
            data-domains={analytics.domain}
            data-exclude-search="true"
            data-exclude-hash="true"
          />
        ) : null}
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
        <LoginEvent />
        <Outlet />
      </AppProviders>
    </QueryClientProvider>
  );
}

// 根错误边界（spec 第 7.4 节）：接住根组件的 loader 和中间件、以及 :lang? 布局的中间件抛出的错误，包括 /foo、/fr/x
// 这类第一段认不出语言的地址返回的 404；在浏览器里，布局的错误边界自己渲染出错往上冒的也到这里。子页面的错误由布局的
// 错误边界接住。服务端渲染时 SiteShell 里崩溃到不了这里，最后是 React Router 的纯文本 500。这里只有出错卡片，
// 不带页头和账号信息。
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return (
    <div className="px-4 py-16">
      <ErrorCard error={error} />
    </div>
  );
}
