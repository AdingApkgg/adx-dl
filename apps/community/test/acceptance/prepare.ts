import { randomBytes } from "node:crypto";
import { chmod, chown, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { writeSeaweedConfig } from "../../ops/seaweed/write-config";
import { RECIPE_BUILD } from "../../src/media-worker/image-child";

const fixture = "/acceptance-fixture";
const state = "/acceptance-state";
await mkdir(fixture, { recursive: true, mode: 0o700 });
const owner = await stat(fixture);
await chmod(fixture, 0o700);
const roles: Record<string, string> = {};
for (const role of ["WEB", "MEDIA", "CONTROL", "BACKUP"])
  for (const key of ["ACCESS_KEY_ID", "SECRET_ACCESS_KEY"])
    roles[`STORAGE_${role}_${key}`] = randomBytes(32).toString("hex");
await writeSeaweedConfig(fixture, roles);
const config = JSON.parse(await readFile(`${fixture}/s3.json`, "utf8"));
for (const identity of config.identities) identity.name = `community-test-${identity.name}`;
// The admin is synthetic and only used by opt-in test fixture setup.
config.identities.push({
  name: "community-test-admin",
  credentials: [{ accessKey: randomBytes(32).toString("hex"), secretKey: randomBytes(32).toString("hex") }],
  actions: ["Admin", "Read", "Write", "List", "Tagging"],
});
await writeFile(`${fixture}/s3.json`, JSON.stringify(config), { mode: 0o600 });
await chown(`${fixture}/s3.json`, owner.uid, owner.gid);
const password = randomBytes(24).toString("hex");
const database = (name: string, host = "postgres") => `postgres://community:${password}@${host}:5432/${name}`;
const common: Record<string, string> = {
  NODE_ENV: "production", HOST: "0.0.0.0", PORT: "3000",
  PUBLIC_ORIGIN: "http://127.0.0.1:41909", PUBLIC_CONTACT_EMAIL: "fixture@example.test",
  DATABASE_URL: database("community_acceptance_ui_test"), REDIS_URL: "redis://redis:6379/1",
  BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), GOOGLE_CLIENT_ID: "isolated-fixture", GOOGLE_CLIENT_SECRET: "isolated-fixture",
  TURNSTILE_SITE_KEY: "1x00000000000000000000AA", TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
  QQ_SENDER: "napcat", QQ_CODE_HMAC_KEY: randomBytes(32).toString("hex"),
  NAPCAT_HTTP_URL: "http://127.0.0.1:9", NAPCAT_WS_URL: "ws://127.0.0.1:9",
  NAPCAT_ACCESS_TOKEN: randomBytes(32).toString("hex"), NAPCAT_BOT_QQ: "10001",
  STORAGE_S3_ENDPOINT: "http://seaweedfs:8333", STORAGE_TEMP_DIR: "/media-tmp", STORAGE_CAPACITY_DIR: "/storage-capacity",
  STORAGE_INTERNAL_MEDIA_SECRET: randomBytes(32).toString("hex"),
  STORAGE_RECIPE_BUILD: RECIPE_BUILD, STORAGE_RESTORE_STATE_DIR: "/storage-state", STORAGE_INTERNAL_PORT: "3001",
  NO_PROXY: "localhost,127.0.0.1,postgres,redis,seaweedfs,web,restore-postgres,restore-seaweedfs",
};
async function env(name: string, values: Record<string, string>) {
  if (Object.values(values).some((value) => /[\r\n]/.test(value))) throw new Error("ACCEPTANCE_ENV_INVALID");
  await writeFile(`${fixture}/${name}.env`, Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n") + "\n", { mode: 0o600 });
  await chown(`${fixture}/${name}.env`, owner.uid, owner.gid);
}
await env("web", {
  ...common, COMMUNITY_ADMIN_PUBLIC_IDS: "1",
  STORAGE_WEB_ACCESS_KEY_ID: roles.STORAGE_WEB_ACCESS_KEY_ID!, STORAGE_WEB_SECRET_ACCESS_KEY: roles.STORAGE_WEB_SECRET_ACCESS_KEY!,
});
await env("media", {
  ...common, STORAGE_MEDIA_ACCESS_KEY_ID: roles.STORAGE_MEDIA_ACCESS_KEY_ID!, STORAGE_MEDIA_SECRET_ACCESS_KEY: roles.STORAGE_MEDIA_SECRET_ACCESS_KEY!,
});
await env("control", {
  ...common, STORAGE_CONTROL_ACCESS_KEY_ID: roles.STORAGE_CONTROL_ACCESS_KEY_ID!, STORAGE_CONTROL_SECRET_ACCESS_KEY: roles.STORAGE_CONTROL_SECRET_ACCESS_KEY!,
  STORAGE_INTERNAL_MEDIA_URL: "http://web:3001", CLOUDFLARE_ZONE_ID: "00000000000000000000000000000000", CLOUDFLARE_PURGE_TOKEN: "isolated-no-network-fixture",
  STORAGE_JOURNAL_DIR: "/storage-journal", STORAGE_JOURNAL_KEY_FILE: "/storage-keys/journal-key",
});
await env("bootstrap", {
  ...common, TEST_DATABASE_URL: common.DATABASE_URL!, TEST_REDIS_URL: "redis://redis:6379",
  STORAGE_RESTORE_STATE_DIR: "/acceptance-ui/restore", STORAGE_JOURNAL_DIR: "/acceptance-ui/journal", STORAGE_JOURNAL_KEY_FILE: "/acceptance-ui/keys/journal-key",
  STORAGE_STAGING_DIR: "/acceptance-ui/stage", STORAGE_BUNDLE_ROOT: "/acceptance-ui/bundles",
  STORAGE_BACKUP_ACCESS_KEY_ID: roles.STORAGE_BACKUP_ACCESS_KEY_ID!, STORAGE_BACKUP_SECRET_ACCESS_KEY: roles.STORAGE_BACKUP_SECRET_ACCESS_KEY!,
});
await env("restore", {
  ...common, NODE_ENV: "test", TEST_DATABASE_URL: database("community_storage_restore_source_test"), TEST_REDIS_URL: "redis://redis:6379",
  STORAGE_TEST_ENDPOINT: "http://seaweedfs:8333", STORAGE_TEST_TARGET_ENDPOINT: "http://restore-seaweedfs:8333",
  STORAGE_TEST_CAPACITY_DIR: "/storage-capacity",
  STORAGE_TEST_TARGET_DATABASE_URL: database("community_storage_restore_test", "restore-postgres"),
  STORAGE_TEST_FIXTURE_PATH: "/acceptance-fixture/s3.json", STORAGE_TEST_REAL_ROLES: "1", STORAGE_TEST_FRESH_RESTORE: "1",
});
const compose: Record<string, string> = { ACCEPTANCE_PG_PASSWORD: password };
for (const key of ["ACCEPTANCE_ROOT", "ACCEPTANCE_PROJECT", "ACCEPTANCE_APP_IMAGE", "ACCEPTANCE_BACKUP_IMAGE", "ACCEPTANCE_TEST_IMAGE", "ACCEPTANCE_SEAWEED_IMAGE"]) {
  const value = process.env[key];
  if (!value) throw new Error("ACCEPTANCE_INPUT_REQUIRED");
  compose[key] = value;
}
await env("compose", compose);
for (const name of ["ui", "proof"]) await mkdir(`${state}/${name}`, { recursive: true, mode: 0o700 });
await mkdir("/source-storage/.capacity", { recursive: true, mode: 0o700 });
console.log("ISOLATED_ACCEPTANCE_FIXTURE_CREATED");
