import { test, expect } from "bun:test";

async function runShutdown(mode: "graceful" | "stalled" | "rejected" | "already-lost" | "healthy") {
  const module = new URL("./process-supervision.ts", import.meta.url).href;
  const child = Bun.spawn([process.execPath, "--eval", `
    import { superviseStorageRole } from ${JSON.stringify(module)};
    const controller = new AbortController();
    const mode = ${JSON.stringify(mode)};
    if (mode === "already-lost") controller.abort();
    superviseStorageRole(controller.signal, async () => {
      console.log("cleanup-started");
      if (mode === "stalled") await new Promise(() => {});
      if (mode === "rejected") throw new Error("private database error");
      await Bun.sleep(10);
      console.log("cleanup-completed");
    }, 200);
    if (mode !== "healthy") { controller.abort(); controller.abort(); }
  `], { stdout: "pipe", stderr: "pipe" });
  const kill = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    return { out, err, code };
  } finally { clearTimeout(kill); }
}

test("lost role drains once then exits nonzero so the container can restart", async () => {
  const result = await runShutdown("graceful");
  expect(result.code).toBe(1);
  expect(result.out).toBe("cleanup-started\ncleanup-completed\n");
  expect(result.err).toBe("STORAGE_ROLE_LOST\n");
});
test("healthy role leaves normal process exit untouched", async () => {
  const result = await runShutdown("healthy");
  expect(result.code).toBe(0);
  expect(result.out).toBe("");
  expect(result.err).toBe("");
});
test("loss before supervision attaches still drains and exits", async () => {
  const result = await runShutdown("already-lost");
  expect(result.code).toBe(1);
  expect(result.out).toBe("cleanup-started\ncleanup-completed\n");
});
test("stalled drain has a bounded nonzero exit", async () => {
  const result = await runShutdown("stalled");
  expect(result.code).toBe(1);
  expect(result.out).toBe("cleanup-started\n");
});
test("rejected drain exits without exposing private database errors", async () => {
  const result = await runShutdown("rejected");
  expect(result.code).toBe(1);
  expect(result.err).toBe("STORAGE_ROLE_LOST\n");
});
