import { expect, test } from "bun:test";
import { AVATAR_RULE, STORAGE_LIMITS, purposeRule } from "./rules";
test("avatar quotas, new part defaults and legacy ceilings are exact", () => {
  expect(AVATAR_RULE.maxSize).toBe(8_388_608);
  expect(AVATAR_RULE.quota).toBe(33_554_432);
  expect(AVATAR_RULE.partSize).toBe(1_048_576);
  expect(STORAGE_LIMITS.partSize).toBe(4_194_304);
  expect(AVATAR_RULE.allowedMime).toEqual(["image/jpeg", "image/png", "image/webp", "image/avif"]);
  expect(AVATAR_RULE.maxPixels).toBe(16_000_000);
  expect(AVATAR_RULE.maxDimension).toBe(8192);
  expect(AVATAR_RULE.maxOutputSize).toBe(524_288);
  expect(STORAGE_LIMITS.maxSize).toBe(480_000_000);
  expect(STORAGE_LIMITS.maxParts).toBe(115);
  for (const purpose of ["avatar", "chart-source"] as const) {
    const rule = purposeRule(purpose);
    expect(Math.ceil(rule.maxSize / rule.partSize)).toBeLessThanOrEqual(STORAGE_LIMITS.maxParts);
  }
});
