import { describe, expect, test } from "bun:test";

import type { ApiClient } from "@/shared/api-client";
import { makeQueryClient } from "@/shared/query-client";

import { profileQuery } from "./profile";

// 只实现这个查询会调用的 /api/v1/me/profile。
function fakeApi(respond: () => Response) {
  return { api: { v1: { me: { profile: { $get: async () => respond() } } } } } as unknown as ApiClient;
}

describe("profileQuery", () => {
  test("键挂在 me 下面，返回接口给的资料", async () => {
    const body = { name: "阿丁", bio: "", onboardedAt: null };

    expect(Array.from(profileQuery(fakeApi(() => Response.json(body))).queryKey)).toEqual(["me", "profile"]);
    expect(await makeQueryClient().query(profileQuery(fakeApi(() => Response.json(body))))).toEqual(body);
  });
});
