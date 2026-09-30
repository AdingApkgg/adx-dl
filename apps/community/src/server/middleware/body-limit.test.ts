import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { bodyLimitWhenDeclared } from "./body-limit";

const MAX_SIZE = 1024;

// 接口回报它看到的东西：方法、c.req.raw 还是不是限制之前的那个对象、读得到的请求体。
function probe() {
  return new Hono<{ Variables: { rawBeforeLimit: Request } }>()
    .use("*", async (c, next) => {
      c.set("rawBeforeLimit", c.req.raw);
      await next();
    })
    .use("*", bodyLimitWhenDeclared({ maxSize: MAX_SIZE, onError: (c) => c.json({ tooLarge: true }, 413) }))
    .all("/x", async (c) =>
      c.json({ method: c.req.method, sameRequest: c.req.raw === c.get("rawBeforeLimit"), body: await c.req.text() })
    );
}

// 请求体是流的 Request，一块一块地给；不给块就是空的流。头只有 headers 里写的：不会自己补 Content-Length。
// Node 要求流式请求体带 duplex，Bun 不在乎；TS 的 RequestInit 里没有它，所以要断言一下。
function streamRequest(method: string, headers: Record<string, string>, ...chunks: string[]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Request("http://test/x", { method, headers, body, duplex: "half" } as RequestInit);
}

describe("bodyLimitWhenDeclared", () => {
  // 开发服务器里 @hono/node-server 的请求垫片，对没有请求体的 DELETE 也给一个空的请求体流，请求上又没有 Content-Length
  // 也没有 Transfer-Encoding（curl -X DELETE 就是这样）。Hono 的 bodyLimit 见到有请求体流又没有长度，就读空它、换一个
  // 新的 Request；垫片换出来的新 Request 丢了方法，变成 GET。所以没有声明请求体的请求必须原样放行。
  test("没有声明请求体（空的请求体流，没有 Content-Length 和 Transfer-Encoding）：原样放行，方法不变，c.req.raw 不被替换", async () => {
    for (const method of ["DELETE", "PATCH", "POST", "PUT"]) {
      const request = streamRequest(method, {});
      // 前提：这样造出来的请求确实什么都没声明。
      expect([request.headers.has("content-length"), request.headers.has("transfer-encoding")], method).toEqual([
        false,
        false,
      ]);

      const res = await probe().request(request);

      expect(await res.json(), method).toEqual({ method, sameRequest: true, body: "" });
    }
  });

  test("Content-Length 声明的大小超过上限：413，响应是 onError 给的，不进接口", async () => {
    const body = "a".repeat(MAX_SIZE + 1);

    const res = await probe().request("/x", {
      method: "POST",
      headers: { "content-length": String(body.length) },
      body,
    });

    expect([res.status, await res.json()]).toEqual([413, { tooLarge: true }]);
  });

  // 分块传输没有长度可比，Hono 边读边数。
  test("Transfer-Encoding: chunked：累计超过上限返回 413；没超的交给接口，读得到", async () => {
    const headers = { "transfer-encoding": "chunked" };
    // 每一块都不到上限，合起来才超（513 + 513 > 1024）。
    const over = await probe().request(streamRequest("POST", headers, "a".repeat(513), "a".repeat(513)));
    const within = await probe().request(streamRequest("POST", headers, "a".repeat(512), "a".repeat(512)));

    expect([over.status, await over.json()]).toEqual([413, { tooLarge: true }]);
    // 数大小要把请求体读进内存，接口拿到的是装着同一份内容的新 Request。
    expect(within.status).toBe(200);
    expect(await within.json()).toMatchObject({ method: "POST", body: "a".repeat(1024) });
  });

  test("带 Content-Length、在上限内的请求体：交给接口，读得到", async () => {
    const body = JSON.stringify({ hello: "world" });

    const res = await probe().request("/x", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(body.length) },
      body,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ method: "POST", body });
  });
});
