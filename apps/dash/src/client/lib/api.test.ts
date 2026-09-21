import { afterEach, describe, expect, test } from "bun:test";

import { ApiError, api } from "./api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  // post()/dispatch()/rerun()/cancel() 都读 globalThis.fetch；每个用例结束
  // 后都要把它还原，不然这个替身会漏到同一个进程里其他测试文件去。
  globalThis.fetch = originalFetch;
});

function stubFetch(body: string, init: ResponseInit) {
  globalThis.fetch = (() => Promise.resolve(new Response(body, init))) as typeof fetch;
}

describe("post()（dispatch/rerun/cancel 共用）", () => {
  test("2xx 但 body 是 HTML——按失败处理，不当成已提交", async () => {
    // 模拟 Cloudflare Access 把登录挑战页编成 2xx 回的情况：本任务没有
    // 办法确认这个部署上的 Access 真的会不会这么做，但 post() 不该依赖
    // 「它不会」。
    stubFetch("<html><body>请登录 Cloudflare Access…</body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });

    await expect(api.rerun(1)).rejects.toBeInstanceOf(ApiError);
  });

  test("2xx 且是 JSON，但不是 accepted:true 这个形状——同样按失败处理", async () => {
    stubFetch(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    await expect(api.cancel(1)).rejects.toBeInstanceOf(ApiError);
  });

  test("真正的 202 + accepted:true——视为成功", async () => {
    stubFetch(JSON.stringify({ accepted: true, ref: "main" }), {
      status: 202,
      headers: { "content-type": "application/json" },
    });

    await expect(api.dispatch(1)).resolves.toBeUndefined();
  });

  test("非 2xx 仍然按状态码透传成 ApiError（409/422/502 不该被这个改动影响）", async () => {
    stubFetch(JSON.stringify({ error: "run 已经结束，不能重跑" }), {
      status: 409,
      headers: { "content-type": "application/json" },
    });

    try {
      await api.rerun(1);
      throw new Error("expected api.rerun to reject");
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      expect(error.status).toBe(409);
      expect(error.message).toContain("run 已经结束");
    }
  });
});
