import { describe, expect, test } from "bun:test";

import { ApiError } from "./api";
import { describeRouteError } from "./route-error";

describe("describeRouteError", () => {
  test("ApiError——服务器给了明确的状态码，归为「拒绝」而不是「没连上」", () => {
    const info = describeRouteError(new ApiError("installation token revoked", 502));

    expect(info.heading).toBe("服务器拒绝了这次请求");
    expect(info.detail).toContain("502");
    expect(info.detail).toContain("installation token revoked");
  });

  test("accessJwt 中间件自己的 403（也是一个 ApiError）——同样归为「拒绝」", () => {
    const info = describeRouteError(new ApiError("Access 断言无效", 403));

    expect(info.heading).toBe("服务器拒绝了这次请求");
    expect(info.detail).toContain("403");
  });

  test("react-router 自己的 ErrorResponse（isRouteErrorResponse 为真）", () => {
    // isRouteErrorResponse 是纯 duck-type 检查（.status/.statusText/.internal
    // 三个字段的类型，加上 "data" in error），不需要真的经过路由匹配就能
    // 造一个满足它的对象——这正是选它而不是自己重新发明一遍判断逻辑的原因。
    const routeError = { status: 404, statusText: "Not Found", internal: false, data: null };

    const info = describeRouteError(routeError);

    expect(info.heading).toBe("服务器拒绝了这次请求");
    expect(info.detail).toContain("404");
    expect(info.detail).toContain("Not Found");
  });

  test("ApiError 不会被误判成 isRouteErrorResponse（两者形状不重叠）", () => {
    // 这是这个函数存在的核心理由：如果两者形状混在一起，前面那条 ApiError
    // 分支就是死代码。ApiError 只有 .status/.message，没有 .statusText/
    // .internal，isRouteErrorResponse 对它必须是 false。
    const apiError = new ApiError("run not found", 404);

    expect((apiError as unknown as { statusText?: unknown }).statusText).toBeUndefined();
  });

  test("原始网络错误（fetch 本身 reject，没有状态码）——不冒充知道更多", () => {
    const info = describeRouteError(new TypeError("Failed to fetch"));

    expect(info.heading).toBe("没能从服务器拿到响应");
    expect(info.detail).toContain("Failed to fetch");
  });

  test("2xx 但 body 解析失败（Access 登录页被当成 200 HTML 返回）——同一个兜底分支", () => {
    const info = describeRouteError(new SyntaxError("Unexpected token '<', \"<html><h\"... is not valid JSON"));

    expect(info.heading).toBe("没能从服务器拿到响应");
    expect(info.detail).toContain("Unexpected token");
  });

  test("非 Error 的怪东西也不崩", () => {
    const info = describeRouteError("plain string thrown");

    expect(info.heading).toBe("没能从服务器拿到响应");
    expect(info.detail).toContain("plain string thrown");
  });

  test("null/undefined 也不崩", () => {
    expect(() => describeRouteError(null)).not.toThrow();
    expect(() => describeRouteError(undefined)).not.toThrow();
  });
});
