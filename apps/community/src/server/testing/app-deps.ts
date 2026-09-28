import { createLogger } from "@/shared/log";

import type { AppDeps } from "../app";
import { createMemoryRateLimitStore } from "../middleware/rate-limit";

export const TEST_PUBLIC_ORIGIN = "https://community.test";

export function testAppDeps(overrides: Partial<AppDeps> = {}) {
  const lines: string[] = [];
  const deps: AppDeps = {
    log: createLogger((line) => lines.push(line)),
    isProduction: true,
    checks: {},
    rateLimitStore: createMemoryRateLimitStore(),
    publicOrigin: TEST_PUBLIC_ORIGIN,
    ...overrides,
  };
  return {
    deps,
    logs: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}
