import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { createLogger } from "@/shared/log";

import { createTurnstileVerifier } from "./turnstile";

let received: Record<string, unknown>[] = [];
let mode: "normal" | "error" | "slow" = "normal";
let lines: string[] = [];

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const body = (await req.json()) as Record<string, unknown>;
    received.push(body);
    if (mode === "error") {
      return new Response("oops", { status: 500 });
    }
    if (mode === "slow") {
      await Bun.sleep(300);
    }
    return Response.json(
      body.response === "pass" ? { success: true } : { success: false, "error-codes": ["invalid-input-response"] }
    );
  },
});

afterAll(() => {
  server.stop(true);
});

beforeEach(() => {
  received = [];
  mode = "normal";
  lines = [];
});

function verifier(timeoutMs = 2000) {
  return createTurnstileVerifier({
    secretKey: "turnstile-secret",
    log: createLogger((line) => lines.push(line)),
    siteverifyUrl: new URL("/siteverify", server.url).href,
    timeoutMs,
  });
}

describe("createTurnstileVerifier", () => {
  test("通过时返回 ok，并把密钥、令牌和访客 IP 发给 Cloudflare", async () => {
    expect(await verifier()("pass", "203.0.113.7")).toBe("ok");
    expect(received).toEqual([{ secret: "turnstile-secret", response: "pass", remoteip: "203.0.113.7" }]);
  });

  test("不通过时返回 failed；没有 IP 时不发 remoteip", async () => {
    expect(await verifier()("nope", null)).toBe("failed");
    expect(received).toEqual([{ secret: "turnstile-secret", response: "nope" }]);
  });

  test("Cloudflare 出错或超时是 unavailable，只记日志、不记令牌", async () => {
    mode = "error";
    expect(await verifier()("pass", null)).toBe("unavailable");
    mode = "slow";
    expect(await verifier(50)("pass", null)).toBe("unavailable");

    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.includes("turnstile_unavailable") && !line.includes("pass"))).toBe(true);
  });

  test("空令牌和超长令牌直接判失败，不发请求", async () => {
    expect(await verifier()("", null)).toBe("failed");
    expect(await verifier()("x".repeat(2049), null)).toBe("failed");
    expect(received).toEqual([]);
  });
});
