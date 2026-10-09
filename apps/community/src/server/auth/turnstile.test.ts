import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { createLogger } from "@/shared/log";

import { createTurnstileVerifier, turnstileRemoteIp } from "./turnstile";

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
    // 真正的 siteverify 在成功时带回令牌出自哪个域名（hostname）、前端渲染 widget 时给的用途（action）。
    const passes: Record<string, unknown> = {
      pass: { success: true, hostname: "community.test", action: "qq-send-code" },
      "pass-signup": { success: true, hostname: "community.test", action: "passkey-sign-up" },
      "pass-elsewhere": { success: true, hostname: "evil.example", action: "qq-send-code" },
      // Cloudflare 的测试密钥：hostname 总是 example.com，没有 action（2026-10-06 实测）。
      "pass-testing-key": { success: true, hostname: "example.com", metadata: { result_with_testing_key: true } },
    };
    return Response.json(passes[String(body.response)] ?? { success: false, "error-codes": ["invalid-input-response"] });
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
    expectedHostname: "community.test",
    siteverifyUrl: new URL("/siteverify", server.url).href,
    timeoutMs,
  });
}

describe("createTurnstileVerifier", () => {
  test("通过时返回 ok，并把密钥、令牌和访客 IP 发给 Cloudflare", async () => {
    expect(await verifier()("pass", "203.0.113.7", "qq-send-code")).toBe("ok");
    expect(received).toEqual([{ secret: "turnstile-secret", response: "pass", remoteip: "203.0.113.7" }]);
  });

  test("不通过时返回 failed；没有 IP 时不发 remoteip", async () => {
    expect(await verifier()("nope", null, "qq-send-code")).toBe("failed");
    expect(received).toEqual([{ secret: "turnstile-secret", response: "nope" }]);
  });

  test("Cloudflare 出错或超时是 unavailable，只记日志、不记令牌", async () => {
    mode = "error";
    expect(await verifier()("pass", null, "qq-send-code")).toBe("unavailable");
    mode = "slow";
    expect(await verifier(50)("pass", null, "qq-send-code")).toBe("unavailable");

    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.includes("turnstile_unavailable") && !line.includes("pass"))).toBe(true);
  });

  test("空令牌和超长令牌直接判失败，不发请求", async () => {
    expect(await verifier()("", null, "qq-send-code")).toBe("failed");
    expect(await verifier()("x".repeat(2049), null, "qq-send-code")).toBe("failed");
    expect(received).toEqual([]);
  });

  // 令牌出自别的网站（同一个站点密钥挂在别处），或者是给另一种用途拿的（通行密钥注册的令牌拿来发 QQ 验证码），都不认。
  test("hostname 不是本站、action 不是这次的用途：failed，记 turnstile_mismatch，不记令牌", async () => {
    expect(await verifier()("pass-elsewhere", null, "qq-send-code")).toBe("failed");
    expect(await verifier()("pass-signup", null, "qq-send-code")).toBe("failed");
    expect(await verifier()("pass-signup", null, "passkey-sign-up")).toBe("ok");

    const mismatches = lines.map((line) => JSON.parse(line)).filter((entry) => entry.event === "turnstile_mismatch");
    expect(mismatches.map(({ hostname, action, expectedAction }) => ({ hostname, action, expectedAction }))).toEqual([
      { hostname: "evil.example", action: "qq-send-code", expectedAction: "qq-send-code" },
      { hostname: "community.test", action: "passkey-sign-up", expectedAction: "qq-send-code" },
    ]);
    expect(lines.some((line) => line.includes("pass-"))).toBe(false);
  });

  // 本机开发和测试用 Cloudflare 的测试密钥：它回的 hostname 是 example.com、没有 action，核对了就永远不过。
  test("测试密钥的结果（metadata.result_with_testing_key）不核对 hostname 和 action", async () => {
    expect(await verifier()("pass-testing-key", null, "qq-send-code")).toBe("ok");
  });
});

describe("turnstileRemoteIp", () => {
  const withIp = (value: string) => new Request("https://example.test/", { headers: { "cf-connecting-ip": value } });

  test("原样返回 Cloudflare 给的 IPv4 和 IPv6，IPv6 不截成 /64", () => {
    expect(turnstileRemoteIp(withIp("203.0.113.7"))).toBe("203.0.113.7");
    expect(turnstileRemoteIp(withIp("2001:db8:1234:5678:9abc:def0:1234:5678"))).toBe(
      "2001:db8:1234:5678:9abc:def0:1234:5678"
    );
  });

  test("不是合法的 IP 时返回 null", () => {
    expect(turnstileRemoteIp(withIp("not-an-ip"))).toBeNull();
    expect(turnstileRemoteIp(withIp("203.0.113.7, 198.51.100.1"))).toBeNull();
  });

  test("没有这个头、没有请求时返回 null", () => {
    expect(turnstileRemoteIp(new Request("https://example.test/"))).toBeNull();
    expect(turnstileRemoteIp(undefined)).toBeNull();
  });
});
