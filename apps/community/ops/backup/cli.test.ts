import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

test("backup CLI reaches its fail-closed startup without an import deadlock", async () => {
  // A valid open state reaches the coordinator import. Closed state returns
  // earlier and would hide the circular import used by the real backup CLI.
  const stateDirectory = await mkdtemp(resolve(tmpdir(), "backup-cli-"));
  await writeFile(resolve(stateDirectory, "state.json"), JSON.stringify({
    version: 1, state: "open", restoreId: crypto.randomUUID(), journal: null,
    updatedAt: new Date().toISOString(),
  }), { mode: 0o600 });
  const child = Bun.spawn([process.execPath, "ops/backup/export.ts"], {
    cwd: resolve(import.meta.dir, "../.."),
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", STORAGE_RESTORE_STATE_DIR: stateDirectory },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill(), 4000);
  try {
    expect(await child.exited).toBe(1);
    expect(await new Response(child.stderr).text()).toContain("STORAGE_BACKUP_FAILED");
  } finally {
    clearTimeout(timer);
    child.kill();
    await rm(stateDirectory, { recursive: true, force: true });
  }
}, 6000);
