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

/** 同 stubFetch，但把每次调用的 url/init 记下来，供断言 URL 编码、method 之类的调用细节。 */
function stubFetchCapturing(body: string, init: ResponseInit) {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = ((url: string, reqInit?: RequestInit) => {
    calls.push({ url, init: reqInit });
    return Promise.resolve(new Response(body, init));
  }) as typeof fetch;
  return calls;
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

describe("ApiError.detail（服务端 errors/step/conflictPaths，提交冲突界面要靠它们）", () => {
  test("commitContent() 校验失败（400）：body 里的 errors 数组能通过 detail 拿到", async () => {
    stubFetch(
      JSON.stringify({
        error: "校验未通过",
        errors: ["社区与联系方式：contactChannels[0].url: 不是合法的 URL"],
      }),
      { status: 400, headers: { "content-type": "application/json" } }
    );

    try {
      await api.commitContent({ message: "m", files: [] });
      throw new Error("expected api.commitContent to reject");
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      expect(error.status).toBe(400);
      expect(error.message).toBe("校验未通过");
      expect(error.detail.errors).toEqual(["社区与联系方式：contactChannels[0].url: 不是合法的 URL"]);
    }
  });

  test("commitContent() 遇到 baseSha 过期（409）：body 里的 step 与 conflictPaths 能通过 detail 拿到", async () => {
    stubFetch(
      JSON.stringify({
        error: "baseSha 已过期",
        step: "commit",
        conflictPaths: ["apps/web/content/community.json"],
      }),
      { status: 409, headers: { "content-type": "application/json" } }
    );

    try {
      await api.commitContent({ message: "m", files: [] });
      throw new Error("expected api.commitContent to reject");
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      expect(error.status).toBe(409);
      expect(error.detail.step).toBe("commit");
      expect(error.detail.conflictPaths).toEqual(["apps/web/content/community.json"]);
    }
  });

  test("get 路径（比如 contentFiles）失败时同样能拿到 detail，不是只有 post/postJson 路径才有", async () => {
    stubFetch(JSON.stringify({ error: "上游超时", retryable: true }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });

    try {
      await api.contentFiles();
      throw new Error("expected api.contentFiles to reject");
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      expect(error.status).toBe(502);
      expect(error.message).toBe("上游超时");
      expect(error.detail).toEqual({ error: "上游超时", retryable: true });
    }
  });

  test("错误 body 不是 JSON 对象（比如 Access 的 HTML 登录页）：message 退回前 200 字符，detail 是空对象", async () => {
    stubFetch("<html>Cloudflare Access 登录页…</html>", {
      status: 401,
      headers: { "content-type": "text/html" },
    });

    try {
      await api.contentFiles();
      throw new Error("expected api.contentFiles to reject");
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      expect(error.status).toBe(401);
      expect(error.message).toBe("<html>Cloudflare Access 登录页…</html>");
      expect(error.detail).toEqual({});
    }
  });
});

describe("contentFiles / contentFile / commitContent（新增的内容端点封装）", () => {
  test("contentFiles() 打 GET /api/content，响应体原样解析返回", async () => {
    const calls = stubFetchCapturing(JSON.stringify([{ key: "community", path: "x", title: "y", module: "z" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    const files = await api.contentFiles();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/content");
    expect(files).toEqual([{ key: "community", path: "x", title: "y", module: "z" }]);
  });

  test("contentFile(key) 会对 key 做 URL 编码", async () => {
    const calls = stubFetchCapturing(JSON.stringify({ key: "a b", path: "x", title: "y", data: {}, sha: "s" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    await api.contentFile("a b");

    expect(calls[0].url).toBe("/api/content/a%20b");
  });

  test("commitContent() 走 postJson：POST 到 /api/content/commit，返回解析后的 body（含 commitSha/commitUrl），不是 void", async () => {
    const calls = stubFetchCapturing(
      JSON.stringify({ accepted: true, commitSha: "abc123", commitUrl: "https://github.com/x/y/commit/abc123" }),
      { status: 202, headers: { "content-type": "application/json" } }
    );

    const request = { message: "m", files: [] };
    const result = await api.commitContent(request);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/content/commit");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual(request);
    expect(result).toEqual({
      accepted: true,
      commitSha: "abc123",
      commitUrl: "https://github.com/x/y/commit/abc123",
    });
  });
});
