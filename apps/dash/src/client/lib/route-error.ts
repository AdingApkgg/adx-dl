import { isRouteErrorResponse } from "react-router";

import { ApiError } from "./api";

export type RouteErrorInfo = {
  /** 一句话结论，供 ErrorBoundary 当标题用。 */
  heading: string;
  /** 补充一行细节：有状态码就带上，没有就给一句诚实的兜底描述。 */
  detail: string;
};

/**
 * 把 clientLoader/渲染阶段抛出来的任意错误，归成操作员能看懂的两句话，
 * 尽量区分「服务器明确拒绝了」与「根本没拿到看得懂的响应」。
 *
 * 这个应用里 loader 实际可能抛出的东西分三种：
 *
 *   1. ApiError（有 .status，见 lib/api.ts）——fetch 拿到了一个响应，只是
 *      状态码不 ok，或者 2xx 但 body 不是期待的形状。这条覆盖了
 *      accessJwt 中间件自己的 403、withGitHubErrors 映射出的
 *      404/409/422/502。有明确状态码可看，归为「服务器拒绝了」。
 *
 *   2. react-router 自己的路由错误（isRouteErrorResponse 为真，见它导出
 *      处的文档：4xx/5xx Response 或者内部路由失败会生成这种错误）。这个
 *      应用目前没有 loader 会主动抛 Response——但 isRouteErrorResponse
 *      是纯 duck-type 检查（看 error 上是不是同时有 .status/.statusText/
 *      .internal 与 "data" 这四样，装的是 react-router 内部的
 *      ErrorResponseImpl，跟 ApiError 的形状不会撞——`error instanceof
 *      ApiError` 只有 .status/.message，没有 .statusText/.internal），
 *      不依赖任何路由上下文，加上它不费事，以后即使加了会抛 Response 的
 *      loader（或者 URL 没匹配上任何路由，那也会走这条）也不用回来改
 *      这里。同样归为「服务器拒绝了」。
 *
 *   3. 其余任何东西——fetch() 本身 reject（DNS 解析失败、连不上、离线、
 *      CORS）；或者 res.ok 但 body 解析失败（Cloudflare Access 把登录
 *      挑战页编码成 200 HTML 时，get() 里的 res.json() 会在这里炸出一个
 *      普通的 SyntaxError，见 lib/api.ts 同类注释）。这两种都没有一个
 *      有意义的状态码可看，在这里没法可靠地互相区分——不装作能分辨，
 *      统一归为「没能从服务器拿到响应」。
 */
export function describeRouteError(error: unknown): RouteErrorInfo {
  if (error instanceof ApiError) {
    return {
      heading: "服务器拒绝了这次请求",
      detail: `HTTP ${error.status}：${error.message}`,
    };
  }

  if (isRouteErrorResponse(error)) {
    return {
      heading: "服务器拒绝了这次请求",
      detail: `HTTP ${error.status}${error.statusText ? ` ${error.statusText}` : ""}`,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    heading: "没能从服务器拿到响应",
    detail: `可能是网络不通，也可能是登录会话已过期。原始错误：${message}`,
  };
}
