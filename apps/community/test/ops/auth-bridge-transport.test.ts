import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";

const SRC_PATH = join(import.meta.dir, "../../ops/acceptance/auth-bridge.ts");
const START = 'const headers = new Headers({ cookie, host: "adxc.saop.cc" });';
const END = '} catch { return new Response("Upstream unavailable", { status: 502 }); }';

const HTML = "<!doctype html><html><body><h1>fixture</h1></body></html>";
const JSON_SMALL = '{"ok":true}';
const GZ = gzipSync(Buffer.from(HTML));

type Forward = (
  origin: string,
  url: URL,
  request: Request,
  cookie: string,
  proxy: undefined,
  fetch: typeof globalThis.fetch,
) => Promise<Response>;

function extractForwardBlock(): string {
  const src = readFileSync(SRC_PATH, "utf8");
  const s = src.indexOf(START);
  const e = src.indexOf(END);
  if (s < 0 || e < 0 || e < s) throw new Error("forward block anchors not found");
  return src.slice(s, e + END.length);
}

function buildForward(): Forward {
  const block = extractForwardBlock();
  const body = `return (async () => {\nlet reads = 0;\n${block}\n})();`;
  return new Function("origin", "url", "request", "cookie", "proxy", "fetch", body) as Forward;
}

let server: ReturnType<typeof Bun.serve>;
let origin: string;

beforeAll(() => {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const p = new URL(req.url).pathname;
      if (p === "/gz") {
        return new Response(new Uint8Array(GZ), {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "content-encoding": "gzip",
            "content-length": String(GZ.length),
            "set-cookie": "a=1; Path=/",
            "set-auth-token": "tok",
          },
        });
      }
      if (p === "/echo-encoding") {
        const ae = req.headers.get("accept-encoding") ?? "none";
        return new Response(new Uint8Array(Buffer.from(ae)), {
          status: 200,
          headers: { "content-type": "text/plain", "content-length": String(Buffer.byteLength(ae)) },
        });
      }
      if (p === "/identity") {
        return new Response(new Uint8Array(Buffer.from(JSON_SMALL)), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "content-length": String(Buffer.byteLength(JSON_SMALL)),
            "set-cookie": "b=2; Path=/",
            "set-auth-token": "tok2",
          },
        });
      }
      return new Response("nf", { status: 404 });
    },
  });
  origin = server.url.origin;
});

afterAll(() => {
  server.stop(true);
});

describe("auth-bridge forward transport", () => {
  test("gzip upstream: raw encoded bytes forwarded verbatim, CE/CL preserved", async () => {
    const forward = buildForward();
    const url = new URL(`${origin}/gz`);
    const request = new Request(url, { method: "GET", headers: { "accept-encoding": "gzip" } });
    const res = await forward(origin, url, request, "fixture-only", undefined, globalThis.fetch);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBe("gzip");
    expect(res.headers.get("content-length")).toBe(String(GZ.length));
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBe(GZ.length);
    expect(Buffer.from(bytes).equals(GZ)).toBe(true);
    expect(gunzipSync(Buffer.from(bytes)).toString("utf8")).toBe(HTML);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("set-auth-token")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  test("identity upstream: body unchanged, cookie/token stripped, cache private no-store", async () => {
    const forward = buildForward();
    const url = new URL(`${origin}/identity`);
    const request = new Request(url, { method: "GET" });
    const res = await forward(origin, url, request, "fixture-only", undefined, globalThis.fetch);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-encoding")).toBeNull();
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Buffer.from(bytes).toString("utf8")).toBe(JSON_SMALL);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("set-auth-token")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  const cases: Array<[string, string | null, string]> = [
    ["explicit identity", "identity", "identity"],
    ["no accept-encoding", null, "identity"],
    ["gzip", "gzip", "gzip"],
    ["gzip q=0", "gzip;q=0", "identity"],
    ["br only", "br", "identity"],
    ["deflate then gzip q=.5", "deflate,gzip;q=.5", "gzip"],
  ];
  for (const [name, header, expected] of cases) {
    test(`negotiation: ${name} -> upstream ${expected}`, async () => {
      const forward = buildForward();
      const url = new URL(`${origin}/echo-encoding`);
      const headers: Record<string, string> = {};
      if (header !== null) headers["accept-encoding"] = header;
      const request = new Request(url, { method: "GET", headers });
      const res = await forward(origin, url, request, "fixture-only", undefined, globalThis.fetch);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(expected);
    });
  }
});
