import { expect, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { backupCapacityRequirements, preflightSpace } from "./export";
const MiB = 1024 ** 2, GiB = 1024 ** 3;
async function fixture() {
  const dir = await fs.mkdtemp(join(tmpdir(), "capacity-policy-"));
  const paths = { stage: join(dir, "stage"), bundle: join(dir, "bundle"), repo: join(dir, "repo"), objects: join(dir, "objects") };
  for (const path of Object.values(paths)) await fs.mkdir(path);
  return { dir, paths };
}
function original(body: string) {
  return { size: Buffer.byteLength(body), sha256: createHash("sha256").update(body).digest("hex") };
}

test("empty and small actual manifests need current backup space, not 20/2/2 GiB ceilings", async () => {
  const { dir, paths } = await fixture();
  const statfs = spyOn(fs, "statfs").mockResolvedValue({ bsize: 1, blocks: 8 * GiB, bavail: 6 * GiB } as Awaited<ReturnType<typeof fs.statfs>>);
  try {
    for (const entries of [[], [original("small current original")]]) {
      const requirements = await backupCapacityRequirements(entries, paths, 2 * MiB);
      expect(requirements[0]).toEqual({ path: paths.objects, additional: 0 });
      expect(requirements[1].additional).toBe(entries.reduce((n, e) => n + e.size, 0));
      expect(requirements.reduce((n, r) => n + r.additional, 0)).toBeLessThan(GiB);
      expect((await preflightSpace(requirements)).size).toBe(1);
    }
  } finally { statfs.mockRestore(); await fs.rm(dir, { recursive: true, force: true }); }
});

test("only hash-verified read-only staging reduces current missing bytes; full payload remains in repo demand", async () => {
  const { dir, paths } = await fixture();
  const entries = [original("already cached"), original("missing"), original("corrupted"), original("writable")];
  try {
    await fs.writeFile(join(paths.stage, entries[0].sha256), "already cached", { mode: 0o400 });
    await fs.writeFile(join(paths.stage, entries[2].sha256), "different", { mode: 0o400 });
    await fs.writeFile(join(paths.stage, entries[3].sha256), "writable", { mode: 0o600 });
    const requirements = await backupCapacityRequirements(entries, paths, 2 * MiB);
    const actual = entries.reduce((n, e) => n + e.size, 0), overhead = 14 * MiB;
    expect(requirements[1].additional).toBe(actual - entries[0].size);
    expect(requirements[2].additional).toBe(2 * MiB + overhead);
    expect(requirements[3].additional).toBe(actual + 2 * MiB + 2 * overhead + 256 * MiB);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("same-filesystem demands aggregate once and still require exactly the 5 GiB floor", async () => {
  const { dir, paths } = await fixture();
  let available = 0;
  const statfs = spyOn(fs, "statfs").mockImplementation((async () => ({ bsize: 1, blocks: 20 * GiB, bavail: available } as Awaited<ReturnType<typeof fs.statfs>>)) as typeof fs.statfs);
  try {
    const requirements = await backupCapacityRequirements([original("actual")], paths, 4 * MiB);
    const total = requirements.reduce((n, r) => n + r.additional, 0);
    available = total + 5 * GiB - 1;
    await expect(preflightSpace(requirements)).rejects.toThrow("STORAGE_BACKUP_DISK_LOW");
    available++;
    const devices = await preflightSpace(requirements);
    expect(devices.size).toBe(1);
    expect([...devices.values()][0].bytes).toBe(total);
    expect(statfs).toHaveBeenCalledTimes(2);
  } finally { statfs.mockRestore(); await fs.rm(dir, { recursive: true, force: true }); }
});
