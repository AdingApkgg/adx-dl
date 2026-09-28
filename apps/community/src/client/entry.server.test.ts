import { describe, expect, spyOn, test } from "bun:test";
import { RouterContextProvider, UNSAFE_ErrorResponseImpl } from "react-router";

import { createLogger } from "@/shared/log";
import { requestMetaContext } from "@/shared/router-context";

import { handleError, reportSsrError } from "./entry.server";

function capture() {
  const lines: string[] = [];
  return { log: createLogger((line) => lines.push(line)), lines };
}

function contextWith(requestId: string): RouterContextProvider {
  const context = new RouterContextProvider();
  context.set(requestMetaContext, { requestId, nonce: undefined, origin: "https://community.test" });
  return context;
}

describe("reportSsrError", () => {
  test("写一行 JSON：请求 ID、方法、路径和错误，不带查询串", () => {
    const { log, lines } = capture();
    const request = new Request("https://community.test/en/charts?token=secret-token");

    reportSsrError(log, new Error("boom"), { request, context: contextWith("req-1") });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      level: "error",
      event: "ssr_error",
      requestId: "req-1",
      method: "GET",
      path: "/en/charts",
      name: "Error",
      message: "boom",
    });
    expect(lines[0]).not.toContain("secret-token");
  });

  // 和服务端 onError 用同一个 describeError：数据库查询错误只记 SQL，不记参数。
  test("数据库查询错误不记参数", () => {
    const { log, lines } = capture();
    const error = Object.assign(new Error("Failed query: select $1\nparams: sess_secret"), {
      query: "select $1",
      params: ["sess_secret"],
    });

    reportSsrError(log, error, { request: new Request("https://community.test/"), context: contextWith("req-2") });

    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ event: "ssr_error", query: "select $1" });
    expect(lines[0]).not.toContain("sess_secret");
  });

  // 比如往没有 action 的页面 POST：React Router 把真正的错误包在 405 响应里。
  test("React Router 包装过的错误，记状态码和里面的错误", () => {
    const { log, lines } = capture();
    const error = new UNSAFE_ErrorResponseImpl(405, "Method Not Allowed", new Error("no action"), true);
    const request = new Request("https://community.test/", { method: "POST" });

    reportSsrError(log, error, { request, context: contextWith("req-3") });

    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      event: "ssr_error",
      method: "POST",
      status: 405,
      name: "Error",
      message: "no action",
    });
  });

  // 访客关掉或离开页面时请求被中止，这不算错误（React Router 默认也不记）。
  test("请求已经中止时不记", () => {
    const { log, lines } = capture();
    const controller = new AbortController();
    controller.abort();
    const request = new Request("https://community.test/", { signal: controller.signal });

    reportSsrError(log, new Error("aborted"), { request, context: contextWith("req-4") });

    expect(lines).toHaveLength(0);
  });

  // React Router 在建好请求上下文之前出错时，传进来的 context 是 undefined。
  test("没有请求上下文时照样记，不抛错", () => {
    const { log, lines } = capture();
    const request = new Request("https://community.test/");

    expect(() => reportSsrError(log, new Error("early"), { request, context: undefined })).not.toThrow();
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ event: "ssr_error", path: "/", message: "early" });
  });
});

describe("handleError", () => {
  test("loader 的错误按这个格式写到标准输出", () => {
    const spy = spyOn(console, "log").mockImplementation(() => {});
    try {
      handleError(new Error("loader failed"), {
        request: new Request("https://community.test/ja"),
        context: contextWith("req-5"),
        params: {},
      });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(spy.mock.calls[0]?.[0]))).toMatchObject({
        event: "ssr_error",
        requestId: "req-5",
        path: "/ja",
        message: "loader failed",
      });
    } finally {
      spy.mockRestore();
    }
  });
});
