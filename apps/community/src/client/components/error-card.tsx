import { Button } from "@astrodx/ui/components/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@astrodx/ui/components/card";
import { isRouteErrorResponse, useRevalidator, useRouteLoaderData } from "react-router";

import { m } from "@/paraglide/messages.js";
import { localizeHref } from "@/paraglide/runtime.js";

import type { loader as rootLoader } from "../root";

// 出错时内容区的卡片（spec 第 7.4 节），:lang? 布局和根组件的错误边界共用。状态码由抛出的错误决定，这里不管。
// 404：页面不存在，附回首页的链接。其他错误：出错了，附请求 ID、"重试"和"回首页"。
export function ErrorCard({ error }: { error: unknown }) {
  // 这是这次页面加载时服务端渲染那个请求的 ID。站内跳转出错时它指向的是最初那次请求，
  // 排查时按它找到访客和时间，再看前后的日志。
  const requestId = useRouteLoaderData<typeof rootLoader>("root")?.requestId;
  const revalidator = useRevalidator();
  const notFound = isRouteErrorResponse(error) && error.status === 404;

  return (
    <main>
      <Card className="mx-auto max-w-lg">
        <CardHeader>
          <CardTitle asChild>
            <h1 className="text-xl font-semibold">{notFound ? m.error_not_found_title() : m.error_server_title()}</h1>
          </CardTitle>
          <CardDescription>{notFound ? m.error_not_found_body() : m.error_server_body()}</CardDescription>
        </CardHeader>
        {!notFound && requestId ? (
          <CardContent>
            <p className="text-muted-foreground">
              {m.error_request_id()}: <code className="font-mono text-foreground">{requestId}</code>
            </p>
          </CardContent>
        ) : null}
        <CardFooter className="gap-2">
          {notFound ? null : (
            // 站内跳转时断网也会落到这里（spec 第 11.4 节）：重新执行当前页面的 loader，成功就恢复正常页面。
            <Button type="button" disabled={revalidator.state === "loading"} onClick={() => revalidator.revalidate()}>
              {m.error_retry()}
            </Button>
          )}
          {/* 整页跳转：出错之后浏览器里的状态未必可靠。 */}
          <Button asChild variant={notFound ? "default" : "outline"}>
            <a href={localizeHref("/")}>{m.error_home()}</a>
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
