import { defineConfig } from "vitest/config";

// The package's tests run in a simulated DOM so components can be clicked and
// typed into, not only server-rendered. Web, the community site and dash keep
// bun test; only this package uses vitest.
export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
