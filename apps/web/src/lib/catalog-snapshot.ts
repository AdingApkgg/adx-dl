/** Share immutable build input per worker; development keeps fresh reads. */
export function createSnapshotReader<T>(load: () => Promise<T>, retain: boolean): () => Promise<T> {
  let snapshot: Promise<T> | undefined;
  return () => {
    if (!retain) return load();
    snapshot ??= load().catch((error: unknown) => {
      snapshot = undefined;
      throw error;
    });
    return snapshot;
  };
}
