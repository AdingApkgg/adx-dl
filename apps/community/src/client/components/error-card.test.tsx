import { dehydrate, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server.edge";
import {
  createMemoryRouter,
  RouterProvider,
  UNSAFE_ErrorResponseImpl,
  UNSAFE_withErrorBoundaryProps,
} from "react-router";

import { m } from "@/paraglide/messages.js";
import { paraglideMiddleware } from "@/paraglide/server.js";
import { makeQueryClient } from "@/shared/query-client";

import { ErrorBoundary as LayoutErrorBoundary } from "../routes/locale";
import { ErrorCard } from "./error-card";

const USER = { id: "abc2345678", name: "阿丁", image: null, status: "active", createdAt: "", deletionPurgeAt: null };

// 和真实页面一样的两层路由：根（loader 给出请求 ID）和 :lang? 布局（loader 给出当前用户），错误挂在布局上。
// 错误边界用 React Router 框架模式的包装（它把 error 作为 props 传进去）。
async function renderLayoutError(path: string, error: unknown): Promise<string> {
  const queryClient = makeQueryClient();
  queryClient.setQueryData(["me"], USER);
  const router = createMemoryRouter(
    [
      {
        id: "root",
        path: "/",
        children: [
          {
            id: "routes/locale",
            path: ":lang?",
            ErrorBoundary: UNSAFE_withErrorBoundaryProps(LayoutErrorBoundary),
            children: [{ path: "*" }],
          },
        ],
      },
    ],
    {
      initialEntries: [path],
      hydrationData: {
        loaderData: {
          root: { requestId: "req-for-test", origin: "https://x.test" },
          "routes/locale": { locale: "zh", dehydratedState: dehydrate(queryClient) },
        },
        errors: { "routes/locale": error },
      },
    }
  );
  let html = "";
  await paraglideMiddleware(new Request(`https://x.test${path}`), async () => {
    html = renderToStaticMarkup(
      <QueryClientProvider client={makeQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
    return new Response();
  });
  return html;
}

const notFound = new UNSAFE_ErrorResponseImpl(404, "Not Found", null);

describe(":lang? 布局的错误边界", () => {
  test("404：页头照样在（头像也在），内容区是'页面不存在'的卡片，附回首页的链接，没有重试和请求 ID", async () => {
    const html = await renderLayoutError("/u/missing", notFound);

    expect(html).toContain("<header");
    expect(html).toContain(`aria-label="${m.nav_account_menu({ name: USER.name })}"`);
    expect(html).toContain(m.error_not_found_title());
    expect(html).toContain(m.error_not_found_body());
    expect(html).toMatch(new RegExp(`<a[^>]*href="/"[^>]*>${m.error_home()}</a>`));
    expect(html).not.toContain(m.error_retry());
    expect(html).not.toContain("req-for-test");
  });

  test("其他错误：'出错了'，带请求 ID、重试和回首页", async () => {
    const html = await renderLayoutError("/settings/account", new Error("boom"));

    expect(html).toContain("<header");
    expect(html).toContain(m.error_server_title());
    expect(html).toContain(`${m.error_request_id()}: <code`);
    expect(html).toContain(">req-for-test</code>");
    expect(html).toMatch(new RegExp(`<button[^>]*>${m.error_retry()}</button>`));
    expect(html).toContain(`>${m.error_home()}</a>`);
    expect(html).not.toContain("boom");
  });

  test("英文页面：文案和回首页的链接都是英文版", async () => {
    const html = await renderLayoutError("/en/u/missing", notFound);

    expect(html).toContain(m.error_not_found_title({}, { locale: "en" }));
    expect(html).toMatch(new RegExp(`<a[^>]*href="/en/"[^>]*>${m.error_home({}, { locale: "en" })}</a>`));
  });
});

// 根组件的错误边界只放这张卡片，不带页头和账号信息。
describe("出错卡片本身", () => {
  test("不含页头", async () => {
    const router = createMemoryRouter([{ id: "root", path: "/", element: <ErrorCard error={new Error("boom")} /> }], {
      hydrationData: { loaderData: { root: { requestId: "req-for-test", origin: "" } } },
    });
    const html = renderToStaticMarkup(<RouterProvider router={router} />);

    expect(html).not.toContain("<header");
    expect(html).toContain(m.error_server_title());
    expect(html).toContain(">req-for-test</code>");
  });
});
