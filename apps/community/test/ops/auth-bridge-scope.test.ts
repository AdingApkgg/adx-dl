import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Execute the real policy from the bridge source instead of mirroring it.
const source = readFileSync(join(import.meta.dir, "../../ops/acceptance/auth-bridge.ts"), "utf8");
const start = source.indexOf("const matches = (path: string) => {");
const end = source.indexOf("\n};\nfunction authorized");
if (start < 0 || end < 0) throw new Error("matches() anchors not found in auth-bridge.ts");
const body = source.slice(start, end + 3).replace("(path: string)", "(path)");
const matches = new Function(`${body}\nreturn matches;`)() as (path: string) => boolean;

const allowed = ["/", "/en", "/en/", "/ja", "/ja/", "/en/charts", "/settings/profile", "/__manifest"];
const denied = ["/en/not-a-smoke-route", "/en//", "/en/api/auth/get-session", "/ja/settings/account/blocked", "/en/__manifest", "/en.data", "/api/auth/get-session"];

test("public localized home pages are in read scope", () => {
  for (const p of allowed) expect(matches(p)).toBe(true);
});

test("localized home allowlist stays exact, not a prefix", () => {
  for (const p of denied) expect(matches(p)).toBe(false);
});
