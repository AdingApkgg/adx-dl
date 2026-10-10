import { expect, test } from "bun:test";
import { createStorageContext } from "./runtime";
import { parseStorageEnv } from "./env";
import type { StorageContext, ObjectDriver } from "./contracts";
const config = () =>
  parseStorageEnv(
    {
      PUBLIC_ORIGIN: "https://community.example.test",
      STORAGE_S3_ENDPOINT: "http://seaweedfs:8333",
      STORAGE_TEMP_DIR: "/storage/tmp",
      STORAGE_RECIPE_BUILD: "test",
      STORAGE_WEB_ACCESS_KEY_ID: "test-access",
      STORAGE_WEB_SECRET_ACCESS_KEY: "test-secret",
      STORAGE_INTERNAL_MEDIA_SECRET: "test-secret-0123456789abcdef012345",
    },
    "web",
  );
test("injected driver/config need no process env or storage connectivity", () => {
  const driver = {
    ready: async () => {
      throw new Error("offline");
    },
  } as unknown as ObjectDriver;
  const context = createStorageContext({
    db: {} as StorageContext["db"],
    boss: async () => {
      throw new Error("unused");
    },
    log: { info() {}, warn() {}, error() {} },
    config: config(),
    driver,
  });
  expect(context.driver).toBe(driver);
  expect(context.config.role).toBe("web");
});
test("explicit runtime construction rejects missing role keys", () => {
  expect(() =>
    createStorageContext({
      db: {} as StorageContext["db"],
      boss: async () => {
        throw new Error("unused");
      },
      log: { info() {}, warn() {}, error() {} },
      source: {},
      role: "web",
    }),
  ).toThrow("STORAGE_WEB_ACCESS_KEY_ID");
});
