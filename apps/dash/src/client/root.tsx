import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

import { describeRouteError } from "./lib/route-error";
import type { Route } from "./+types/root";

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

// 任何路由的 clientLoader 或渲染阶段抛出的错误，只要那条路由自己没有
// ErrorBoundary，就会往上冒泡到最近的祖先——这个应用里没有一个 routes/
// 下的模块导出自己的 ErrorBoundary，所以这里是唯一、也是全局的接住点。
// 因为它挂在根路由上，react-router 仍然会用上面的 Layout 包一层再渲染
// 它（跟正常渲染时包住 <Outlet/> 是同一套机制），<html>/<head>/<Scripts/>
// 这些文档骨架不会因为出错就消失；这里另外套一层 .dash-shell，让它在
// 视觉上也落在这个应用自己的版式里，而不是 react-router 默认的裸错误页。
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  // 界面上的两句话是给操作员看的概括；完整的原始错误（包括堆栈）留在
  // 控制台，真要排查的人开着 devtools 就能看到，不需要界面把它整段吐出来。
  console.error(error);
  const { heading, detail } = describeRouteError(error);

  return (
    <main className="dash-shell">
      <h1>出错了</h1>
      <p className="dash-notice dash-notice--bad" role="alert">
        {heading}
      </p>
      <p className="dash-muted">{detail}</p>
      <p>
        <button type="button" onClick={() => window.location.reload()}>
          刷新页面
        </button>
      </p>
    </main>
  );
}
