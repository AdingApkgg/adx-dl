import type { StorageErrorCode } from "@/shared/storage";

/** Safe public messages only. Upstream exceptions must not be used as messages. */
export class StorageError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: StorageErrorCode,
    message = code,
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "StorageError";
  }
}
export class ObjectMissingError extends StorageError {
  constructor() {
    super(404, "NOT_FOUND");
    this.name = "ObjectMissingError";
  }
}
export class StorageUnavailableError extends StorageError {
  constructor() {
    super(503, "STORAGE_UNAVAILABLE");
    this.name = "StorageUnavailableError";
  }
}
