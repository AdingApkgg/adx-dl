declare module "bun:test" {
  interface BunMatcher {
    not: BunMatcher;
    toBe: (expected: unknown) => void;
    toContain: (expected: string) => void;
    toEqual: (expected: unknown) => void;
  }

  export const describe: (name: string, fn: () => void | Promise<void>) => void;
  export const test: (name: string, fn: () => void | Promise<void>) => void;
  export const expect: (value: unknown) => BunMatcher;
  export const mock: {
    module: (specifier: string, factory: () => Record<string, unknown>) => void;
  };
}
