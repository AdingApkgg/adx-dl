import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
// Parsed service contracts, followed by real Compose and runtime validation at integration acceptance.
test("role services publish only existing web port, isolate S3 credentials and require no CDN purge token", async () => {
  const c = Bun.YAML.parse(
    await readFile(new URL("../../compose.yaml", import.meta.url), "utf8"),
  ) as any;
  expect(c.services.seaweedfs).toBeDefined();
  expect(c.services.seaweedfs.ports).toBeUndefined();
  expect(c.services.seaweedfs.entrypoint).toEqual(["/opt/community-seaweed/entrypoint.sh"]);
  expect(c.services.seaweedfs.command).toBeUndefined();
  expect(c.services.seaweedfs.pids_limit).toBe(256);
  expect(c.services.seaweedfs.volumes).toContain("./ops/seaweed:/opt/community-seaweed:ro");
  expect(c.services.seaweedfs.depends_on["storage-config"].condition).toBe(
    "service_completed_successfully",
  );
  expect(c.services.web.ports).toEqual(["127.0.0.1:12703:3000"]);
  for (const [service, role] of [
    ["web", "WEB"],
    ["worker", "CONTROL"],
    ["media-worker", "MEDIA"],
    ["backup", "BACKUP"],
  ]) {
    const s = c.services[service];
    expect(s.environment[`STORAGE_${role}_ACCESS_KEY_ID`]).toBeDefined();
    expect(s.environment.NO_PROXY).toContain("seaweedfs");
    for (const other of ["WEB", "CONTROL", "MEDIA", "BACKUP"].filter((x) => x !== role))
      expect(s.environment[`STORAGE_${other}_ACCESS_KEY_ID`]).toBeUndefined();
    expect(s.environment.CLOUDFLARE_ZONE_ID).toBeUndefined();
    expect(s.environment.CLOUDFLARE_PURGE_TOKEN).toBeUndefined();
  }
  expect(c.services["media-worker"].healthcheck.test).toContain("src/server/storage/health.ts");
  expect(c.services["media-worker"].cpus).toBe(1);
  expect(c.services["media-worker"].mem_limit).toBe("512m");
  expect(c.services["media-worker"].tmpfs).toBeUndefined();
  expect(
    c.services["media-worker"].volumes.find((v: any) => v.target === "/media-tmp").bind
      .create_host_path,
  ).toBe(false);
  expect(c.services["media-worker"].stop_grace_period).toBe("135s");
});
