import { ApiError } from "@/shared/api-client";
import type { FileDto, UploadDto } from "@/shared/storage";
import type { StorageApi } from "../queries/storage";

export type UploadRecord = {
  uploadId: string;
  name: string;
  size: number;
  hash: string;
  expiry: string;
};
export type RecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type UploadSnapshot = {
  phase: "idle" | "hashing" | "uploading" | "processing" | "ready" | "error";
  progress: number;
  file?: FileDto;
  uploadId?: string;
  error?: unknown;
};
export type UploadController = {
  start(file: File): Promise<void>;
  resume(file: File, record: UploadRecord): Promise<void>;
  cancel(): Promise<void>;
  forget(uploadId: string): void;
  dispose(): void;
};
const keyFor = (id: string) => `astrodx-uploads:${id}`;
const active = new Map<string, Set<() => void>>();

export function readUploadRecords(storage: RecoveryStorage, userId: string): UploadRecord[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(keyFor(userId)) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (r): r is UploadRecord =>
          r &&
          typeof r.uploadId === "string" &&
          typeof r.name === "string" &&
          Number.isSafeInteger(r.size) &&
          r.size > 0 &&
          r.size <= 8_388_608 &&
          /^[a-f0-9]{64}$/.test(r.hash) &&
          Date.parse(r.expiry) > Date.now(),
      )
      .map(({ uploadId, name, size, hash, expiry }) => ({
        uploadId,
        name,
        size,
        hash,
        expiry,
      }));
  } catch {
    return [];
  }
}
export function clearUploadRecords(userId: string, storage?: RecoveryStorage): void {
  for (const dispose of active.get(userId) ?? []) dispose();
  try {
    (storage ?? localStorage).removeItem(keyFor(userId));
  } catch {
    /* Recovery is optional when browser storage is denied. */
  }
}

export function hashFile(
  file: File,
  { signal, onProgress }: { signal?: AbortSignal; onProgress?: (progress: number) => void } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const worker = new Worker(new URL("../workers/file-hash.ts", import.meta.url), { type: "module" });
    let finished = false;
    const finish = (error?: unknown, hash?: string) => {
      if (finished) return;
      finished = true;
      worker.terminate();
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(hash!);
    };
    const abort = () => finish(new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    worker.onerror = () => finish(new Error("Hash worker failed"));
    worker.onmessage = (
      event: MessageEvent<{
        progress?: number;
        hash?: string;
        error?: boolean;
      }>,
    ) => {
      if (finished) return;
      if (event.data.error) finish(new Error("Hash worker failed"));
      else if (event.data.hash) finish(undefined, event.data.hash);
      else if (event.data.progress !== undefined) onProgress?.(event.data.progress);
    };
    worker.postMessage(file);
  });
}

export function createUploadController({
  api,
  userId,
  storage,
  onState,
}: {
  api: StorageApi;
  userId: string;
  storage: RecoveryStorage;
  onState: (state: UploadSnapshot) => void;
}): UploadController {
  let generation = 0;
  let disposed = false;
  let aborter: AbortController | undefined;
  let uploadId: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let processingSince = 0;
  let processing: { dto: UploadDto; generation: number; signal: AbortSignal } | undefined;
  let pollingGeneration: number | undefined;
  const emit = (state: UploadSnapshot, g = generation) => {
    if (!disposed && g === generation) onState(state);
  };
  const current = (g: number) => !disposed && g === generation && !aborter?.signal.aborted;
  const records = (record?: UploadRecord, removeId?: string) => {
    try {
      const rows = readUploadRecords(storage, userId).filter((r) => r.uploadId !== (record?.uploadId ?? removeId));
      if (record) rows.push(record);
      storage.setItem(keyFor(userId), JSON.stringify(rows));
    } catch {
      /* Upload still works without persistence. */
    }
  };
  const stop = () => {
    ++generation;
    aborter?.abort();
    clearTimeout(timer);
    processing = undefined;
  };
  const terminalError = (dto: UploadDto) =>
    new ApiError(
      400,
      dto.errorCode ?? (dto.state === "expired" ? "UPLOAD_EXPIRED" : "PROCESSING_FAILED"),
      "Upload failed",
    );
  const accept = async (dto: UploadDto, g: number, signal: AbortSignal): Promise<void> => {
    if (!current(g)) return;
    if (dto.state === "ready" && dto.fileId) {
      const file = await api.file(dto.fileId, signal);
      if (!current(g)) return;
      if (file.state !== "ready" || !file.previewUrl) throw terminalError(dto);
      processing = undefined;
      emit({ phase: "ready", progress: 1, file, uploadId: dto.id }, g);
      return;
    }
    if (dto.state !== "processing") {
      records(undefined, dto.id);
      throw terminalError(dto);
    }
    processing = { dto, generation: g, signal };
    emit({ phase: "processing", progress: 1 }, g);
    if (typeof document === "undefined" || !document.hidden)
      timer = setTimeout(() => void poll(), Date.now() - processingSince >= 60_000 ? 5000 : 2000);
  };
  const poll = async () => {
    clearTimeout(timer);
    const context = processing;
    if (!context || pollingGeneration === context.generation || (typeof document !== "undefined" && document.hidden))
      return;
    pollingGeneration = context.generation;
    try {
      await accept(await api.upload(context.dto.id, context.signal), context.generation, context.signal);
    } catch (error) {
      if (current(context.generation)) {
        processing = undefined;
        emit({ phase: "error", progress: 1, error }, context.generation);
      }
    } finally {
      if (pollingGeneration === context.generation) pollingGeneration = undefined;
    }
  };
  const visibility = () => {
    clearTimeout(timer);
    if (!document.hidden) void poll();
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", visibility);
  const run = async (file: File, record?: UploadRecord) => {
    stop();
    const g = generation;
    aborter = new AbortController();
    const signal = aborter.signal;
    uploadId = record?.uploadId;
    try {
      if (
        file.size < 1 ||
        file.size > 8_388_608 ||
        !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.type)
      )
        throw new ApiError(400, "TYPE_NOT_ALLOWED", "Invalid image");
      emit({ phase: "hashing", progress: 0 }, g);
      const hash = await hashFile(file, {
        signal,
        onProgress: (progress) => emit({ phase: "hashing", progress }, g),
      });
      if (!current(g)) return;
      if (record && (record.size !== file.size || record.hash !== hash || Date.parse(record.expiry) <= Date.now()))
        throw new ApiError(400, "HASH_MISMATCH", "Reselect the same file");
      let dto = record
        ? await api.upload(record.uploadId, signal)
        : await api.init(
            {
              purpose: "avatar",
              name: file.name,
              size: file.size,
              sha256: hash,
            },
            crypto.randomUUID(),
            signal,
          );
      if (!current(g)) {
        if (!record) await api.cancel(dto.id);
        return;
      }
      uploadId = dto.id;
      records({
        uploadId: dto.id,
        name: file.name,
        size: file.size,
        hash,
        expiry: dto.expiresAt,
      });
      if (dto.state !== "receiving") {
        processingSince = Date.now();
        await accept(dto, g, signal);
        return;
      }
      for (let index = 0; index < dto.partCount; index++) {
        if (!current(g)) return;
        emit(
          {
            phase: "uploading",
            progress: dto.receivedParts.reduce((sum, p) => sum + p.size, 0) / file.size,
          },
          g,
        );
        if (dto.receivedParts.some((part) => part.index === index)) continue;
        const body = file.slice(index * dto.partSize, Math.min((index + 1) * dto.partSize, file.size));
        const partHash = await hashFile(new File([body], file.name), {
          signal,
        });
        if (!current(g)) return;
        await api.part(dto.id, index, body, partHash, signal);
        if (!current(g)) return;
        dto = await api.upload(dto.id, signal);
      }
      if (!current(g)) return;
      emit(
        {
          phase: "uploading",
          progress: dto.receivedParts.reduce((sum, p) => sum + p.size, 0) / file.size,
        },
        g,
      );
      processingSince = Date.now();
      await accept(await api.complete(dto.id, signal), g, signal);
    } catch (error) {
      if (current(g)) emit({ phase: "error", progress: 0, error }, g);
    }
  };
  const dispose = () => {
    if (disposed) return;
    stop();
    disposed = true;
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", visibility);
    active.get(userId)?.delete(dispose);
  };
  const set = active.get(userId) ?? new Set();
  set.add(dispose);
  active.set(userId, set);
  return {
    start: (file) => run(file),
    resume: (file, record) => run(file, record),
    dispose,
    forget: (id) => records(undefined, id),
    cancel: async () => {
      const id = uploadId;
      stop();
      uploadId = undefined;
      const cancelledGeneration = generation;
      if (id) {
        try {
          await api.cancel(id);
          records(undefined, id);
        } catch (error) {
          emit({ phase: "error", progress: 0, error }, cancelledGeneration);
          return;
        }
      }
      emit({ phase: "idle", progress: 0 }, cancelledGeneration);
    },
  };
}
