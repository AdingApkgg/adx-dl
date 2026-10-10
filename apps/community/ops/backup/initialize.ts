import { mkdir, readdir, open, lstat, chmod } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { journalConfig } from "./runtime";
import { initializeJournal } from "./journal";
import { initializeRestoreState } from "./restore";
/** Explicit first install only. Partial failure stays closed for operator inspection; never adopt old state. */
export async function initializeStorageState() {
  const config = journalConfig(),
    state = process.env.STORAGE_RESTORE_STATE_DIR;
  if (!state) throw new Error("STORAGE_RESTORE_STATE_REQUIRED");
  for (const path of [state, config.directory, dirname(config.keyFile)]) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    if (!(await lstat(path)).isDirectory() || (await readdir(path)).length)
      throw new Error("STORAGE_INITIALIZATION_REQUIRES_EMPTY_STATE");
  }
  for(const path of [state,config.directory,dirname(config.keyFile),process.env.STORAGE_STAGING_DIR,process.env.STORAGE_BUNDLE_ROOT]) {
    if(!path)throw new Error("STORAGE_BACKUP_PATH_INVALID");
    await mkdir(path,{recursive:true,mode:0o700});
    await chmod(path,0o700);
  }
  const key = await open(config.keyFile, "wx", 0o600);
  try {
    await key.writeFile(randomBytes(32));
    await key.sync();
  } finally {
    await key.close();
  }
  await initializeJournal(config);
  await initializeRestoreState(state);
}
if (import.meta.main)
  try {
    await initializeStorageState();
  } catch {
    console.error("STORAGE_INITIALIZATION_FAILED");
    process.exitCode = 1;
  }
