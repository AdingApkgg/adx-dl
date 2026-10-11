import { test, expect } from "bun:test";
import { mkdtemp, rm, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withBackupBundle } from "./runtime";

test("concurrent manual backup invocations keep exclusive private frozen bundles until completion", async () => {
  const root = await mkdtemp(join(tmpdir(), "backup-bundles-"));
  let release!: () => void;
  const pending = new Promise<void>((r) => {
    release = r;
  });
  let firstPath = "";
  try {
    const first = withBackupBundle(root, async (path) => {
      firstPath = path;
      expect((await stat(path)).mode & 0o777).toBe(0o700);
      await writeFile(join(path, "manifest.json"), "first");
      await pending;
      expect(await readFile(join(path, "manifest.json"), "utf8")).toBe("first");
    });
    while (!firstPath) await Bun.sleep(1);
    await withBackupBundle(root, async (path) => {
      expect(path).not.toBe(firstPath);
      await writeFile(join(path, "manifest.json"), "second");
    });
    expect(await Bun.file(join(firstPath, "manifest.json")).exists()).toBe(true);
    release();
    await first;
    expect(await Bun.file(join(firstPath, "manifest.json")).exists()).toBe(false);
  } finally {
    release?.();
    await rm(root, { recursive: true, force: true });
  }
});

test("full backup retention groups unique bundle paths by host and tag only", async () => {
  const { communityFullRetentionCommand } = await import("./export");
  expect(communityFullRetentionCommand()).toEqual(["restic", "forget", "--host", "astrodx-community", "--tag", "community-full", "--group-by", "host,tags", "--prune", "--keep-daily", "7", "--keep-weekly", "4", "--keep-monthly", "6"]);
});
