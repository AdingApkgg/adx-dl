import { StorageError } from "../server/storage/errors";
let occupied = false;
/** One capacity gate for avatar and chart children; run must reap its child before returning. */
export async function withNativeSlot<T>(run: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (occupied) throw new StorageError(503,"STORAGE_BUSY","STORAGE_BUSY",1);
  occupied = true;
  try { return await run(signal ?? new AbortController().signal); }
  finally { occupied = false; }
}
