import { test, expect } from "bun:test";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSeaweedConfig } from "./write-config";

test("private role configuration refuses missing/duplicate credentials before publishing, excludes anonymous", async () => {
  const dir = await mkdtemp(join(tmpdir(), "seaweed-config-"));
  const source: Record<string, string> = {};
  for (const role of ["WEB", "MEDIA", "CONTROL", "BACKUP"]) {
    source[`STORAGE_${role}_ACCESS_KEY_ID`] = `${role}01234567890123456789`;
    source[`STORAGE_${role}_SECRET_ACCESS_KEY`] = `${role}0123456789012345678901234567890123456789`;
  }
  try {
    await expect(writeSeaweedConfig(dir, {})).rejects.toThrow("STORAGE_ROLE_CONFIG_INVALID");
    expect(await Bun.file(join(dir, "s3.json")).exists()).toBe(false);
    await writeSeaweedConfig(dir, source);
    expect((await stat(join(dir, "s3.json"))).mode & 0o777).toBe(0o600);
    const config = JSON.parse(await readFile(join(dir, "s3.json"), "utf8"));
    expect(config.identities.map((i: { name: string }) => i.name)).toEqual([
      "web",
      "media",
      "control",
      "backup",
    ]);
    expect(config.identities[0].actions).toContain("Write:blobs/tmp/*");
    expect(config.identities[0].actions).not.toContain("Write:blobs");
    expect(config.identities[3].actions).toEqual([
      "Read:blobs",
      "List:blobs",
      "Read:derived",
      "List:derived",
    ]);
    const previous = await readFile(join(dir, "s3.json"), "utf8");
    source.STORAGE_WEB_ACCESS_KEY_ID = source.STORAGE_MEDIA_ACCESS_KEY_ID!;
    await expect(writeSeaweedConfig(dir, source)).rejects.toThrow("STORAGE_ROLE_CONFIG_INVALID");
    expect(await readFile(join(dir, "s3.json"), "utf8")).toBe(previous);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
