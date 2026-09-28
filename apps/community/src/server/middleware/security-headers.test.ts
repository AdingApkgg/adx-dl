import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { securityHeaders } from "./security-headers";

function probe(isProduction: boolean) {
  return new Hono()
    .use("*", securityHeaders({ isProduction }))
    .get("/", (c) => c.text(c.get("secureHeadersNonce") ?? ""));
}

describe("securityHeaders", () => {
  test("生产环境强制执行 CSP，script-src 带本次请求的 nonce 和 Turnstile", async () => {
    const res = await probe(true).request("/");
    const nonce = await res.text();
    const csp = res.headers.get("content-security-policy") ?? "";

    expect(nonce.length).toBeGreaterThan(10);
    expect(csp).toContain(`'nonce-${nonce}'`);
    expect(csp).toContain("https://challenges.cloudflare.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(res.headers.get("content-security-policy-report-only")).toBeNull();
  });

  test("每个请求的 nonce 都不一样", async () => {
    const app = probe(true);
    const first = await (await app.request("/")).text();
    const second = await (await app.request("/")).text();
    expect(first).not.toBe(second);
  });

  test("开发环境只报告不拦截", async () => {
    const res = await probe(false).request("/");
    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(res.headers.get("content-security-policy-report-only")).toContain("'nonce-");
  });

  test("Permissions-Policy 关掉用不到的能力，但不碰通行密钥", async () => {
    const policy = (await probe(true).request("/")).headers.get("permissions-policy") ?? "";
    expect(policy).toContain("camera=()");
    expect(policy).toContain("geolocation=()");
    expect(policy).not.toContain("publickey-credentials");
  });

  test("其余几个头", async () => {
    const res = await probe(true).request("/");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("strict-transport-security")).toBeNull();
  });
});
