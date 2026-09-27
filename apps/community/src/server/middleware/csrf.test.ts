import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { csrfGuard } from "./csrf";

const ORIGIN = "https://community.test";

function probe() {
  return new Hono()
    .use("*", csrfGuard({ publicOrigin: ORIGIN }))
    .get("/x", (c) => c.text("read"))
    .post("/x", (c) => c.text("written"));
}

function post(headers: Record<string, string>, body = "{}") {
  return probe().request("/x", { method: "POST", headers, body });
}

describe("csrfGuard", () => {
  test("GET 不受影响", async () => {
    expect((await probe().request("/x")).status).toBe(200);
  });

  test("同源的 JSON 请求放行", async () => {
    const res = await post({ "content-type": "application/json", origin: ORIGIN, "sec-fetch-site": "same-origin" });
    expect(res.status).toBe(200);
  });

  // 别的网站能直接发表单和 text/plain（不触发跨域预检），所以改数据的接口只收 JSON。
  test("不是 JSON 的请求返回 415", async () => {
    const res = await post({ "content-type": "application/x-www-form-urlencoded", origin: ORIGIN }, "a=1");
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ error: { code: "UNSUPPORTED_MEDIA_TYPE" } });
  });

  // 不能借 post() 发：带字符串请求体时，Request 会自动补上 text/plain。
  test("没有 Content-Type 也返回 415", async () => {
    const res = await probe().request("/x", { method: "POST", headers: { origin: ORIGIN } });
    expect(res.status).toBe(415);
  });

  test("Origin 不对返回 403", async () => {
    const res = await post({ "content-type": "application/json", origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "CSRF_ORIGIN_MISMATCH" } });
  });

  test("没有 Origin 返回 403", async () => {
    expect((await post({ "content-type": "application/json" })).status).toBe(403);
  });

  test("Sec-Fetch-Site 不是 same-origin 返回 403", async () => {
    const res = await post({ "content-type": "application/json", origin: ORIGIN, "sec-fetch-site": "same-site" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "CSRF_CROSS_SITE" } });
  });

  // Safari 16.4 之前不发 Sec-Fetch-Site，这时只靠 Origin 校验。
  test("没有 Sec-Fetch-Site 时只看 Origin", async () => {
    const res = await post({ "content-type": "application/json", origin: ORIGIN });
    expect(res.status).toBe(200);
  });

  // App 用 Bearer 令牌，没有 Cookie，也就不存在跨站伪造的问题（spec 第 2.3 节第 3 条）。
  test("带 Bearer 令牌的请求跳过检查", async () => {
    const res = await post({ authorization: "Bearer abc", "content-type": "text/plain" }, "x");
    expect(res.status).toBe(200);
  });
});
