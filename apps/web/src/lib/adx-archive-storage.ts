/** Browser storage only; safe to import without loading the archive codecs. */
const releases = new WeakMap<Blob, () => Promise<void>>();

export type ArchiveBuildOptions = { signal?: AbortSignal; requireDisk?: boolean; useDisk?: boolean };

export type ArchiveDiskSink = {
  writable: WritableStream<Uint8Array>;
  failed: () => boolean;
  finish: (type: string) => Promise<Blob>;
  discard: () => Promise<void>;
};

export function throwIfArchiveAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Archive canceled", "AbortError");
}

/** Each output owns its file until the user releases it, not just until an anchor click. */
export async function releaseArchiveBlob(blob: Blob): Promise<void> {
  const release = releases.get(blob);
  if (!release) return;
  releases.delete(blob);
  await release();
}

/** Unsupported, denied or insufficient storage falls back before allocating an output. */
export async function createArchiveDiskSink(
  expectedBytes: number,
  signal?: AbortSignal
): Promise<ArchiveDiskSink | null> {
  throwIfArchiveAborted(signal);
  let directory: FileSystemDirectoryHandle | undefined;
  let name: string | undefined;
  let writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
  let closed = false;
  let failed = false;
  let discarded = false;
  const discard = async (): Promise<void> => {
    if (discarded) return;
    discarded = true;
    if (writer && !closed) {
      try { await writer.abort(); } catch { /* A failed writer may already be aborted. */ }
      try { writer.releaseLock(); } catch { /* The close path may have released it. */ }
      closed = true;
    }
    if (directory && name) {
      try { await directory.removeEntry(name); } catch { /* Already deleted or storage unavailable. */ }
    }
  };
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) return null;
    const estimate = await navigator.storage.estimate?.();
    throwIfArchiveAborted(signal);
    // Leave room for the output and its export/temporary copy. Estimates are
    // advisory; private browsing can still reject a later write.
    if (estimate?.quota !== undefined && estimate.usage !== undefined &&
      estimate.quota - estimate.usage < expectedBytes * 2) return null;
    throwIfArchiveAborted(signal);
    const root = await navigator.storage.getDirectory();
    directory = await root.getDirectoryHandle("astrodx-archives", { create: true });
    name = `${crypto.randomUUID()}.adx`;
    const handle = await directory.getFileHandle(name, { create: true });
    if (typeof handle.createWritable !== "function") {
      await discard();
      return null;
    }
    throwIfArchiveAborted(signal);
    writer = (await handle.createWritable()).getWriter();
    throwIfArchiveAborted(signal);
    const writable = new WritableStream<Uint8Array>({
      async write(chunk) {
        throwIfArchiveAborted(signal);
        try { await writer!.write(chunk); } catch (error) { failed = true; throw error; }
      },
      async close() {
        try { await writer!.close(); } catch (error) { failed = true; throw error; }
        finally { writer!.releaseLock(); closed = true; }
      },
      async abort() { await discard(); },
    });
    return {
      writable,
      failed: () => failed,
      discard,
      async finish(type) {
        throwIfArchiveAborted(signal);
        try {
          const file = await handle.getFile();
          throwIfArchiveAborted(signal);
          const blob = new File([file], file.name, { type });
          releases.set(blob, discard);
          return blob;
        } catch (error) { failed = true; throw error; }
      },
    };
  } catch {
    await discard();
    throwIfArchiveAborted(signal);
    return null;
  }
}

/** Probe real writable storage; exposing getDirectory alone is insufficient on phones. */
export async function canStreamArchive(expectedInputBytes: number): Promise<boolean> {
  // Inputs/checkpoints, the output, and the browser's export/temporary copy.
  const sink = await createArchiveDiskSink(expectedInputBytes * 1.5 + 4096);
  if (!sink) return false;
  try {
    const writer = sink.writable.getWriter();
    try { await writer.write(new Uint8Array(1)); await writer.close(); }
    finally { writer.releaseLock(); }
    return true;
  } catch { return false; }
  finally { await sink.discard(); }
}

export class ArchiveStorageUnavailableError extends Error {
  constructor() {
    super("Archive disk storage unavailable; retry with smaller parts.");
    this.name = "ArchiveStorageUnavailableError";
  }
}
