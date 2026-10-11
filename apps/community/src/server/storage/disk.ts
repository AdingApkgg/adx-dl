/** Bun exposes frsize on some Linux filesystems; POSIX block counts use that fundamental size.
 * Node implementations without it use bsize. Malformed present metadata never falls back. */
export function storageFilesystemBytes(stats: {
  bsize: number | bigint;
  frsize?: number | bigint;
  blocks: number | bigint;
  bavail: number | bigint;
}) {
  const integer = (value: number | bigint, positive = false) => {
    if (typeof value !== "bigint" && (typeof value !== "number" || !Number.isSafeInteger(value)))
      throw new Error("STORAGE_FILESYSTEM_INVALID");
    const n = BigInt(value);
    if (n < (positive ? 1n : 0n)) throw new Error("STORAGE_FILESYSTEM_INVALID");
    return n;
  };
  const size = integer(stats.frsize === undefined ? stats.bsize : stats.frsize, true);
  const total = integer(stats.blocks) * size,
    available = integer(stats.bavail) * size;
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || available > total)
    throw new Error("STORAGE_FILESYSTEM_INVALID");
  return { total: Number(total), available: Number(available) };
}
