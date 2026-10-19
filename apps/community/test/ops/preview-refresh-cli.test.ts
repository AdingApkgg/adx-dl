import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("preview refresh CLI redacts initialization errors and never echoes a connection string", async () => {
  const marker = "PRIVATE_PREVIEW_REFRESH_SENTINEL";
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("../../ops/charts/refresh-preview.ts", import.meta.url)), "apply", "/nonexistent/private-plan"], {
    env: { PATH: process.env.PATH, DATABASE_URL: `postgres://operator:${marker}@invalid.invalid/community` },
    stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect(code).toBe(1);
  expect(stdout).toBe("");
  expect(stderr.trim()).toBe(JSON.stringify({ status: "failed", code: "PREVIEW_REFRESH_FAILED" }));
  expect(stderr).not.toContain(marker);
});
