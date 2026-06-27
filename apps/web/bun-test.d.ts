// Minimal local typings for `bun:test`. We deliberately avoid pulling in
// `@types/bun`, whose global declarations clash with the DOM lib this app needs.
// Matchers/values are typed loosely (`unknown`) — runtime assertions are what
// matter; this only needs to satisfy `tsc --noEmit` for the test files.
declare module "bun:test" {
  interface BunMatchers {
    not: BunMatchers;
    resolves: BunMatchers;
    rejects: BunMatchers;

    toBe: (expected: unknown) => void;
    toEqual: (expected: unknown) => void;
    toStrictEqual: (expected: unknown) => void;
    toMatchObject: (expected: unknown) => void;
    toContain: (expected: unknown) => void;
    toContainEqual: (expected: unknown) => void;
    toMatch: (expected: string | RegExp) => void;
    toHaveLength: (expected: number) => void;
    toHaveProperty: (keyPath: string | readonly (string | number)[], value?: unknown) => void;

    toBeNull: () => void;
    toBeUndefined: () => void;
    toBeDefined: () => void;
    toBeTruthy: () => void;
    toBeFalsy: () => void;
    toBeNaN: () => void;
    toBeInstanceOf: (expected: unknown) => void;

    toBeGreaterThan: (expected: number | bigint) => void;
    toBeGreaterThanOrEqual: (expected: number | bigint) => void;
    toBeLessThan: (expected: number | bigint) => void;
    toBeLessThanOrEqual: (expected: number | bigint) => void;
    toBeCloseTo: (expected: number, numDigits?: number) => void;

    toThrow: (expected?: unknown) => void;
    toThrowError: (expected?: unknown) => void;

    toHaveBeenCalled: () => void;
    toHaveBeenCalledTimes: (expected: number) => void;
    toHaveBeenCalledWith: (...args: unknown[]) => void;
  }

  /** @deprecated Kept as an alias for any existing `BunMatcher` references. */
  type BunMatcher = BunMatchers;

  interface BunExpect {
    (value: unknown): BunMatchers;
    any: (constructor: unknown) => unknown;
    anything: () => unknown;
    arrayContaining: (sample: readonly unknown[]) => unknown;
    objectContaining: (sample: Record<string, unknown>) => unknown;
    stringContaining: (sample: string) => unknown;
    stringMatching: (sample: string | RegExp) => unknown;
    closeTo: (sample: number, precision?: number) => unknown;
  }

  type MockedFunction<Args extends readonly unknown[], Return> = ((
    ...args: Args
  ) => Return) & {
    mock: {
      calls: Args[];
      results: { type: "return" | "throw"; value: unknown }[];
    };
    mockClear: () => void;
    mockReset: () => void;
    mockRestore: () => void;
    mockImplementation: (fn: (...args: Args) => Return) => void;
    mockImplementationOnce: (fn: (...args: Args) => Return) => void;
    mockReturnValue: (value: Return) => void;
    mockReturnValueOnce: (value: Return) => void;
    mockResolvedValue: (value: unknown) => void;
    mockRejectedValue: (value: unknown) => void;
  };

  interface BunMock {
    <Args extends readonly unknown[], Return>(
      implementation?: (...args: Args) => Return
    ): MockedFunction<Args, Return>;
    module: (specifier: string, factory: () => Record<string, unknown>) => void;
  }

  export const describe: (name: string, fn: () => void | Promise<void>) => void;
  export const test: (name: string, fn: () => void | Promise<void>) => void;
  export const expect: BunExpect;
  export const mock: BunMock;

  type LifecycleHook = (fn: () => void | Promise<void>) => void;
  export const beforeEach: LifecycleHook;
  export const afterEach: LifecycleHook;
  export const beforeAll: LifecycleHook;
  export const afterAll: LifecycleHook;
}
