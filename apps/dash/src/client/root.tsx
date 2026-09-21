import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

import "./app.css";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* 后台不该被任何搜索引擎碰到，即使它在 Access 后面。 */}
        <meta name="robots" content="noindex, nofollow" />
        <title>AstroDX dash</title>
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

// SPA 模式下 index.html 只含根路由的渲染结果，这个 fallback 是用户在
// JS 水合完成前唯一看得到的东西。
export function HydrateFallback() {
  return <p className="dash-loading">载入中…</p>;
}

export default function App() {
  return <Outlet />;
}
