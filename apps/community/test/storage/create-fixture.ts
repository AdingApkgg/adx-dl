import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { writeSeaweedConfig } from "../../ops/seaweed/write-config";
const directory = process.argv[2];
if (!directory) throw new Error("Fixture directory required");
await mkdir(directory, { recursive: true, mode: 0o700 });
const source: Record<string, string> = {};
for (const role of ["WEB", "MEDIA", "CONTROL", "BACKUP"])
  for (const key of ["ACCESS_KEY_ID", "SECRET_ACCESS_KEY"])
    source[`STORAGE_${role}_${key}`] = randomBytes(32).toString("hex");
await writeSeaweedConfig(directory, source);
const path = join(directory, "s3.json"),
  config = JSON.parse(await readFile(path, "utf8"));
for (const identity of config.identities) identity.name = `community-test-${identity.name}`;
config.identities.push({
  name: "community-test-admin",
  credentials: [
    { accessKey: randomBytes(32).toString("hex"), secretKey: randomBytes(32).toString("hex") },
  ],
  actions: ["Admin", "Read", "Write", "List", "Tagging"],
});
await writeFile(path, JSON.stringify(config), { mode: 0o600 });
