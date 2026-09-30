import { describe, expect, test } from "bun:test";

import { type ApiClient, createApiClient } from "@/shared/api-client";
import { makeQueryClient } from "@/shared/query-client";

import { userQuery } from "./user";

// 只实现这个查询会调用的 /api/v1/users/:id。
function fakeApi(respond: () => Response) {
  return { api: { v1: { users: { ":id": { $get: async () => respond() } } } } } as unknown as ApiClient;
}

describe("userQuery", () => {
  test("用户不存在（404）：null，不当成错误", async () => {
    const api = fakeApi(() => Response.json({ error: { code: "NOT_FOUND", message: "User not found" } }, { status: 404 }));

    expect(await makeQueryClient().query(userQuery(api, "abc2345678"))).toBeNull();
  });

  test("找到了：返回接口给的资料", async () => {
    const body = { id: "abc2345678", status: "pending_deletion" as const };

    expect(await makeQueryClient().query(userQuery(fakeApi(() => Response.json(body)), "abc2345678"))).toEqual(body);
  });

  test("别的错误照常抛出", async () => {
    const api = fakeApi(() => Response.json({ error: { code: "RATE_LIMITED", message: "x" } }, { status: 429 }));

    await expect(makeQueryClient().query(userQuery(api, "abc2345678"))).rejects.toMatchObject({ status: 429 });
  });
});

// id 来自网址：路由参数解码之后原样交给 userQuery，而 Hono 客户端把它直接拼进请求路径、不转义。
// URL 解析器把 "\" 当成 "/"，所以 "..\me\profile" 会请求到 /api/v1/me/profile。这里用真的客户端，
// 断言它最终请求的路径：不管 id 写成什么，都只能在 /api/v1/users/ 后面占一段，也不能带出查询串。
describe("userQuery：id 在请求路径里只占一段", () => {
  const cases: [id: string, path: string][] = [
    ["abc2345678", "/api/v1/users/abc2345678"],
    ["..\\me\\profile", "/api/v1/users/..%5Cme%5Cprofile"],
    ["..\\..\\auth\\get-session", "/api/v1/users/..%5C..%5Cauth%5Cget-session"],
    ["abc2345678?admin=1", "/api/v1/users/abc2345678%3Fadmin%3D1"],
  ];

  for (const [id, path] of cases) {
    test(JSON.stringify(id), async () => {
      const requested: URL[] = [];
      const api = createApiClient("http://localhost", {
        fetch: async (input: RequestInfo | URL) => {
          requested.push(new URL(input instanceof Request ? input.url : String(input)));
          return Response.json({ error: { code: "NOT_FOUND", message: "User not found" } }, { status: 404 });
        },
      });

      // 查不到（404）照旧是 null；只发出一个请求，地址是 path。
      expect(await makeQueryClient().query(userQuery(api, id))).toBeNull();
      expect(requested.map((url) => url.pathname + url.search)).toEqual([path]);
    });
  }
});
