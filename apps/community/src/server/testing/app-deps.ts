import type { AppDeps } from "../app";
import { createLogger } from "../log";

export function testAppDeps(overrides: Partial<AppDeps> = {}) {
  const lines: string[] = [];
  const deps: AppDeps = {
    log: createLogger((line) => lines.push(line)),
    isProduction: true,
    checks: {},
    ...overrides,
  };
  return {
    deps,
    logs: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}
