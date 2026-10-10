import { describe, expect, test } from "bun:test";
import { parseStorageEnv } from "./env";
const secret = "test-internal-secret-0123456789abcdef";
const common = {
  PUBLIC_ORIGIN: "https://community.example.test",
  STORAGE_S3_ENDPOINT: "http://seaweedfs:8333",
  STORAGE_TEMP_DIR: "/storage/tmp",
  STORAGE_RECIPE_BUILD: "test-build-v1",
  STORAGE_INTERNAL_MEDIA_SECRET: secret,
  STORAGE_INTERNAL_MEDIA_URL: "http://media:3001",
  CLOUDFLARE_ZONE_ID: "a".repeat(32),
  CLOUDFLARE_PURGE_TOKEN: "test-purge-secret",
};
function source(role: string) {
  return {
    ...common,
    [`STORAGE_${role.toUpperCase()}_ACCESS_KEY_ID`]: "test-access",
    [`STORAGE_${role.toUpperCase()}_SECRET_ACCESS_KEY`]: "test-secret",
  };
}
describe("parseStorageEnv", () => {
  test("role credentials and purge authority are separated", () => {
    for (const role of ["web", "media", "backup", "control"] as const) {
      const config = parseStorageEnv(source(role), role);
      expect(config.role).toBe(role);
      expect(config.endpoint).toBe("http://seaweedfs:8333");
      expect(config.region).toBe("us-east-1");
      expect(config.originalBucket).toBe("blobs");
      expect(config.derivedBucket).toBe("derived");
      expect(config.credentialsRef).toBe(`STORAGE_${role.toUpperCase()}`);
      expect("purgeToken" in config).toBe(role === "control");
      expect("zoneId" in config).toBe(role === "control");
      expect("internalMediaSecret" in config).toBe(role === "web" || role === "control");
    }
  });
  test("missing role requirements report names without values or fallback credentials", () => {
    const bad = {
      ...source("backup"),
      STORAGE_WEB_ACCESS_KEY_ID: "do-not-log-me",
    };
    expect(() => parseStorageEnv(bad, "web")).toThrow("STORAGE_WEB_SECRET_ACCESS_KEY");
    try {
      parseStorageEnv(bad, "web");
    } catch (error) {
      expect(String(error)).not.toContain("do-not-log-me");
    }
    expect(() => parseStorageEnv({}, "control")).toThrow("CLOUDFLARE_PURGE_TOKEN");
  });
  test("canonical origin, endpoint, temp path and build are validated without leaking input", () => {
    for (const [key, value] of [
      ["STORAGE_S3_ENDPOINT", "http://user:private-secret@seaweedfs:8333"],
      ["STORAGE_S3_ENDPOINT", "http://seaweedfs:8333/path"],
      ["STORAGE_S3_ENDPOINT", "http://Seaweedfs:8333"],
      ["PUBLIC_ORIGIN", "https://example.test/query?token=private-secret"],
      ["STORAGE_TEMP_DIR", "relative"],
      ["STORAGE_RECIPE_BUILD", ""],
      ["STORAGE_TEMPORARY_BUDGET", "2147483649"],
      ["STORAGE_MIN_FREE_DISK_BYTES", "1"],
    ]) {
      expect(() => parseStorageEnv({ ...source("web"), [key!]: value }, "web")).toThrow(key);
      try {
        parseStorageEnv({ ...source("web"), [key!]: value }, "web");
      } catch (error) {
        expect(String(error)).not.toContain("private-secret");
      }
    }
  });
  test("budgets may be tightened and required free disk may be increased", () => {
    const config = parseStorageEnv(
      {
        ...source("web"),
        STORAGE_TEMPORARY_BUDGET: "1024",
        STORAGE_MIN_FREE_DISK_BYTES: "6000000000",
      },
      "web",
    );
    expect(config.limits.temporaryBudget).toBe(1024);
    expect(config.limits.minFreeDiskBytes).toBe(6_000_000_000);
  });
});
