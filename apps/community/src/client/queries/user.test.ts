import { describe, expect, test } from "bun:test";

import type { ApiClient } from "@/shared/api-client";
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
