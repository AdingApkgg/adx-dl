import { createLogger } from "@/shared/log";

import type { AppDeps } from "../app";
import { createMemoryRateLimitStore } from "../middleware/rate-limit";
import { createTestAuth } from "./auth";
import { TEST_PUBLIC_ORIGIN } from "./constants";
import { testDbHandle } from "./test-db";

export { TEST_PUBLIC_ORIGIN } from "./constants";

let sharedAuth: AppDeps["auth"] | undefined;

export function testAppDeps(overrides: Partial<AppDeps> = {}) {
  const lines: string[] = [];
  // 不关心账号的测试共用一个 auth 实例。它连测试库，但没带会话 Cookie 的请求不会查库。
  sharedAuth ??= createTestAuth().auth;
  const deps: AppDeps = {
    log: createLogger((line) => lines.push(line)),
    isProduction: true,
    checks: {},
    rateLimitStore: createMemoryRateLimitStore(),
    publicOrigin: TEST_PUBLIC_ORIGIN,
    auth: sharedAuth,
    services: {
      db: testDbHandle().db,
      loginOptions: async () => ({ turnstileSiteKey: "1x00000000000000000000AA", qq: { available: true, botQq: "10001" } }),
    },
    ...overrides,
  };
  return {
    deps,
    logs: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}
