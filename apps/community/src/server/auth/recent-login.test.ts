import { expect, test } from "bun:test";

import { isRecentLogin, RECENT_LOGIN_MS } from "./recent-login";

test("10 分钟以内算刚登录，超过就不算", () => {
  const now = Date.parse("2026-09-29T12:00:00Z");
  expect(RECENT_LOGIN_MS).toBe(600_000);
  expect(isRecentLogin(new Date(now - 9 * 60_000), now)).toBe(true);
  expect(isRecentLogin(new Date(now - 10 * 60_000), now)).toBe(true);
  expect(isRecentLogin(new Date(now - 10 * 60_000 - 1), now)).toBe(false);
  expect(isRecentLogin("2026-09-29T11:55:00.000Z", now)).toBe(true);
});
