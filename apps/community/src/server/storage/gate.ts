import type { ObjectDriver } from "./contracts";
import { ObjectMissingError, StorageUnavailableError } from "./errors";

class StorageSaturatedError extends StorageUnavailableError {}

export function createStorageGate({ limit }: { limit: number; now?: () => number }) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError("Invalid storage concurrency limit");
  let active = 0;
  return {
    acquire() {
      if (active >= limit) throw new StorageSaturatedError();
      active++;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          active--;
        }
      };
    },
  };
}
export function storageStatus(error: unknown): number | undefined {
  if (error instanceof ObjectMissingError) return 404;
  if (typeof error !== "object" || !error) return undefined;
  if ((error as { name?: string }).name === "NoSuchBucket") return undefined;
  const metadata = (error as { $metadata?: { httpStatusCode?: number } }).$metadata;
  return metadata?.httpStatusCode;
}
export function publicStorageError(error: unknown): ObjectMissingError | StorageUnavailableError {
  return storageStatus(error) === 404 ? new ObjectMissingError() : new StorageUnavailableError();
}
export type BreakerAttempt = {
  success(): void;
  failure(error: unknown): void;
  cancel(): void;
};
export function createStorageBreaker({ now = Date.now }: { now?: () => number } = {}) {
  let failures = 0;
  let firstFailure = 0;
  let openUntil: number | null = null;
  let probing = false;
  let epoch = 0;
  return {
    acquire(): BreakerAttempt {
      const time = now();
      if (openUntil !== null && (time < openUntil || probing)) throw new StorageUnavailableError();
      const generation = epoch;
      const probe = openUntil !== null;
      if (probe) probing = true;
      let settled = false;
      const settle = (result: "success" | "failure" | "cancel", error?: unknown) => {
        if (settled || generation !== epoch) return;
        settled = true;
        if (probe) probing = false;
        const status = storageStatus(error);
        if (
          result === "cancel" ||
          error instanceof StorageSaturatedError ||
          (result === "failure" && (status === 404 || status === 403))
        )
          return;
        if (result === "success") {
          failures = 0;
          openUntil = null;
          return;
        }
        const failedAt = now();
        if (!failures || failedAt - firstFailure > 30_000) {
          failures = 0;
          firstFailure = failedAt;
        }
        failures++;
        if (probe || failures >= 5) {
          openUntil = failedAt + 15_000;
          epoch++;
        }
      };
      return {
        success: () => settle("success"),
        failure: (error) => settle("failure", error),
        cancel: () => settle("cancel"),
      };
    },
  };
}

/** Classifies upstream errors before redaction. A GET succeeds only after its body reaches EOF. */
export function withStorageCircuitBreaker(
  driver: ObjectDriver,
  { now }: { now?: () => number } = {},
): ObjectDriver {
  const breaker = createStorageBreaker({ now });
  async function run<T>(
    signal: AbortSignal | undefined,
    fn: () => Promise<T>,
    isSuccess: (value: T) => boolean = () => true,
  ): Promise<T> {
    const attempt = breaker.acquire();
    try {
      const value = await fn();
      if (isSuccess(value)) attempt.success();
      else attempt.cancel();
      return value;
    } catch (error) {
      if (signal?.aborted) attempt.cancel();
      else attempt.failure(error);
      throw publicStorageError(error);
    }
  }
  return {
    put: (input) => run(input.signal, () => driver.put(input)),
    head: (input) =>
      run(
        input.signal,
        () => driver.head(input),
        (value) => value !== null,
      ),
    delete: (input) => run(input.signal, () => driver.delete(input)),
    copy: (input) => run(input.signal, () => driver.copy(input)),
    list: (input) => run(input.signal, () => driver.list(input)),
    ready: (signal) => run(signal, () => driver.ready(signal)),
    async get(input) {
      const attempt = breaker.acquire();
      try {
        const value = await driver.get(input);
        const reader = value.body.getReader();
        void reader.closed.catch((error) => {
          if (input.signal?.aborted) attempt.cancel();
          else attempt.failure(error);
        });
        return {
          ...value,
          body: new ReadableStream<Uint8Array>(
            {
              async pull(controller) {
                try {
                  const next = await reader.read();
                  if (next.done) {
                    attempt.success();
                    controller.close();
                  } else controller.enqueue(next.value);
                } catch (error) {
                  if (input.signal?.aborted) attempt.cancel();
                  else attempt.failure(error);
                  controller.error(publicStorageError(error));
                }
              },
              async cancel(reason) {
                attempt.cancel();
                try {
                  await reader.cancel(reason);
                } catch (error) {
                  throw publicStorageError(error);
                }
              },
            },
            { highWaterMark: 0 },
          ),
        };
      } catch (error) {
        if (input.signal?.aborted) attempt.cancel();
        else attempt.failure(error);
        throw publicStorageError(error);
      }
    },
  };
}
