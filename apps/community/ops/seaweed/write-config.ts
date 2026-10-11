import { mkdir, open, rename, rm, lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

/** Validate every role before the first byte is published. No anonymous bootstrap interval. */
export async function writeSeaweedConfig(
  directory: string,
  source: Record<string, string | undefined> = process.env,
) {
  const keys = new Set<string>();
  const identities = ["web", "media", "control", "backup"].map((name) => {
    const prefix = `STORAGE_${name.toUpperCase()}`;
    const accessKey = source[`${prefix}_ACCESS_KEY_ID`];
    const secretKey = source[`${prefix}_SECRET_ACCESS_KEY`];
    if (
      !accessKey ||
      !secretKey ||
      !/^[A-Za-z0-9_-]{20,128}$/.test(accessKey) ||
      !/^[A-Za-z0-9_-]{32,128}$/.test(secretKey) ||
      keys.has(accessKey)
    )
      throw new Error("STORAGE_ROLE_CONFIG_INVALID");
    keys.add(accessKey);
    const actions = ["Read:blobs", "List:blobs", "Read:derived", "List:derived"];
    if (name === "web") actions.push("Write:blobs/tmp/*");
    if (name === "media") actions.push("Write:blobs/sha256/*", "Write:derived/sha256/*");
    if (name === "control") actions.push("Write:blobs", "Write:derived");
    return { name, credentials: [{ accessKey, secretKey }], actions };
  });
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, `.s3-${crypto.randomUUID()}.json`);
  try {
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify({ identities }));
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, join(directory, "s3.json"));
  } finally {
    await rm(temporary, { force: true });
  }
}
if (import.meta.main) {
  try {
    if (!process.argv[2]) throw new Error("STORAGE_CONFIG_DIRECTORY_REQUIRED");
    await writeSeaweedConfig(process.argv[2]);
    if (process.argv[3]) {
      await mkdir(process.argv[3], { mode: 0o700, recursive: true });
      if (!(await lstat(process.argv[3])).isDirectory() || (await readdir(process.argv[3])).length)
        throw new Error("STORAGE_CAPACITY_PATH_INVALID");
    }
  } catch {
    console.error("STORAGE_ROLE_CONFIG_INVALID");
    process.exitCode = 1;
  }
}
