import type { StoragePurpose } from "@/shared/storage";

export const STORAGE_LIMITS = {
  maxSize: 480_000_000,
  maxParts: 115,
  partSize: 4_194_304,
  activeUploadsPerUser: 2,
  activeUploadsGlobal: 100,
  uploadTtlMs: 86_400_000,
  partLeaseMs: 120_000,
  temporaryBudget: 2_147_483_648,
  originalBudget: 21_474_836_480,
  derivedBudget: 2_147_483_648,
  minFreeDiskBytes: 5_368_709_120,
  readConcurrency: 32,
  putConcurrency: 8,
  partConcurrencyPerUser: 2,
  initializationPerUserHour: 10,
  initializationPerIpHour: 60,
  partsPerUserMinute: 120,
  terminalTemporaryRetentionMs: 3_600_000,
  unknownTemporaryRetentionMs: 172_800_000,
  fileRetentionMs: 86_400_000,
  fileTombstoneRetentionMs: 2_592_000_000,
  orphanGraceMs: 604_800_000,
} as const;
export type PurposeRule = {
  purpose: StoragePurpose;
  maxSize: number;
  quota: number;
  partSize: number;
  allowedMime: readonly string[];
  recipe: string;
  maxPixels: number;
  maxDimension: number;
  maxOutputSize: number;
};
export const AVATAR_RULE = {
  purpose: "avatar",
  minSize: 1,
  maxSize: 8_388_608,
  quota: 33_554_432,
  partSize: STORAGE_LIMITS.partSize,
  allowedMime: ["image/jpeg", "image/png", "image/webp", "image/avif"],
  recipe: "avatar-v1",
  maxPixels: 16_000_000,
  maxDimension: 8192,
  maxOutputSize: 524_288,
  outputWidth: 512,
  outputHeight: 512,
  outputMime: "image/jpeg",
  quality: 85,
} as const satisfies PurposeRule & Record<string, unknown>;
