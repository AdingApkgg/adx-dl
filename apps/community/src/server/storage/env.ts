import { isAbsolute, normalize } from "node:path";
import type { StorageConfig, StorageRole } from "./contracts";
import { STORAGE_LIMITS } from "./rules";

/** Called by each role at startup; never formats an input value into an error. */
export function parseStorageEnv(
  source: Record<string, string | undefined>,
  role: StorageRole,
): StorageConfig {
  const problems = new Set<string>();
  const required = (key: string) => {
    const value = source[key]?.trim();
    if (!value) problems.add(key);
    return value ?? "";
  };
  const origin = (key: string) => {
    const value = required(key);
    try {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol) || url.origin !== value) problems.add(key);
    } catch {
      problems.add(key);
    }
    return value;
  };
  const budget = (key: string, fallback: number, minimum = false) => {
    if (source[key] === undefined || source[key]?.trim() === "") return fallback;
    const value = Number(source[key]);
    if (!Number.isSafeInteger(value) || value < 1 || (minimum ? value < fallback : value > fallback))
      problems.add(key);
    return value;
  };
  const credentialsRef = `STORAGE_${role.toUpperCase()}`;
  const tempDir = required("STORAGE_TEMP_DIR");
  if (!isAbsolute(tempDir) || normalize(tempDir) !== tempDir) problems.add("STORAGE_TEMP_DIR");
  const capacityDir = source.STORAGE_CAPACITY_DIR ?? (source.NODE_ENV === "production" ? required("STORAGE_CAPACITY_DIR") : tempDir);
  if (!isAbsolute(capacityDir) || normalize(capacityDir) !== capacityDir) problems.add("STORAGE_CAPACITY_DIR");
  const recipeBuild = required("STORAGE_RECIPE_BUILD");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(recipeBuild)) problems.add("STORAGE_RECIPE_BUILD");
  const chartRecipeBuild = source.STORAGE_CHART_RECIPE_BUILD?.trim();
  if (chartRecipeBuild && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(chartRecipeBuild)) problems.add("STORAGE_CHART_RECIPE_BUILD");
  const common = {
    publicOrigin: origin("PUBLIC_ORIGIN"),
    endpoint: origin("STORAGE_S3_ENDPOINT"),
    region: "us-east-1",
    originalBucket: "blobs",
    derivedBucket: "derived",
    credentialsRef,
    accessKeyId: required(`${credentialsRef}_ACCESS_KEY_ID`),
    secretAccessKey: required(`${credentialsRef}_SECRET_ACCESS_KEY`),
    tempDir,
    capacityDir,
    recipeBuild,
    ...(chartRecipeBuild ? { chartRecipeBuild } : {}),
    limits: {
      temporaryBudget: budget("STORAGE_TEMPORARY_BUDGET", STORAGE_LIMITS.temporaryBudget),
      originalBudget: budget("STORAGE_ORIGINAL_BUDGET", STORAGE_LIMITS.originalBudget),
      derivedBudget: budget("STORAGE_DERIVED_BUDGET", STORAGE_LIMITS.derivedBudget),
      minFreeDiskBytes: budget("STORAGE_MIN_FREE_DISK_BYTES", STORAGE_LIMITS.minFreeDiskBytes, true),
    },
  };
  let config: StorageConfig;
  if (role === "web" || role === "control") {
    const internalMediaSecret = required("STORAGE_INTERNAL_MEDIA_SECRET");
    if (internalMediaSecret.length < 32) problems.add("STORAGE_INTERNAL_MEDIA_SECRET");
    if (role === "control") {
      const zoneId = required("CLOUDFLARE_ZONE_ID");
      if (!/^[a-fA-F0-9]{32}$/.test(zoneId)) problems.add("CLOUDFLARE_ZONE_ID");
      config = {
        ...common,
        role,
        internalMediaSecret,
        internalMediaUrl: origin("STORAGE_INTERNAL_MEDIA_URL"),
        zoneId,
        purgeToken: required("CLOUDFLARE_PURGE_TOKEN"),
      };
    } else config = { ...common, role, internalMediaSecret };
  } else config = { ...common, role };
  if (problems.size) throw new Error(`Invalid storage environment: ${[...problems].sort().join(", ")}`);
  return config;
}
