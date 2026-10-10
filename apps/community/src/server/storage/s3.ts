import { Readable } from "node:stream";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { ObjectBucket, ObjectDriver, ObjectHead, StorageConfig } from "./contracts";
import { createStorageGate, storageStatus, withStorageCircuitBreaker } from "./gate";
import { STORAGE_LIMITS } from "./rules";
import { StorageUnavailableError } from "./errors";

type DriverOptions = {
  readLimit?: number;
  putLimit?: number;
  requestTimeoutMs?: number;
  now?: () => number;
};
function metadata(value: {
  ContentLength?: number;
  ContentType?: string;
  Metadata?: Record<string, string>;
  ETag?: string;
}): ObjectHead {
  if (
    !Number.isSafeInteger(value.ContentLength) ||
    (value.ContentLength ?? -1) < 0 ||
    !value.ContentType ||
    !/^[a-f0-9]{64}$/.test(value.Metadata?.sha256 ?? "")
  )
    throw new Error("Invalid object metadata");
  return {
    size: value.ContentLength!,
    mime: value.ContentType,
    sha256: value.Metadata!.sha256!,
    etag: value.ETag,
  };
}

export function createS3Driver(config: StorageConfig, options: DriverOptions = {}): ObjectDriver {
  const timeout = options.requestTimeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1) throw new TypeError("Invalid storage request deadline");
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    maxAttempts: 1,
    logger: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
    // Verified on SeaweedFS4.48 / SDK3.1149.0 for known-length streamed PUTs.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const readGate = createStorageGate({
    limit: options.readLimit ?? STORAGE_LIMITS.readConcurrency,
  });
  const writeGate = createStorageGate({
    limit: options.putLimit ?? STORAGE_LIMITS.putConcurrency,
  });
  const bucket = (name: ObjectBucket) => (name === "original" ? config.originalBucket : config.derivedBucket);
  function acquire(write: boolean, caller?: AbortSignal) {
    const release = (write ? writeGate : readGate).acquire();
    const controller = new AbortController();
    const abort = () => controller.abort(new Error("Storage request cancelled"));
    const timer = setTimeout(() => controller.abort(new Error("Storage request deadline")), timeout);
    caller?.addEventListener("abort", abort, { once: true });
    if (caller?.aborted) abort();
    let finished = false;
    return {
      signal: controller.signal,
      finish() {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        caller?.removeEventListener("abort", abort);
        release();
      },
    };
  }
  async function request<T>(
    write: boolean,
    signal: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const permit = acquire(write, signal);
    try {
      return await operation(permit.signal);
    } finally {
      permit.finish();
    }
  }
  const raw: ObjectDriver = {
    put(input) {
      return request(true, input.signal, async (signal) => {
        if (!Number.isSafeInteger(input.size) || input.size < 1 || !/^[a-f0-9]{64}$/.test(input.sha256))
          throw new TypeError("Invalid object input");
        const body = Readable.fromWeb(input.body as unknown as Parameters<typeof Readable.fromWeb>[0]);
        body.on("error", () => {}); // SDK transport owns error reporting; never print upstream messages.
        const abort = () => body.destroy(new Error("Storage request cancelled"));
        signal.addEventListener("abort", abort, { once: true });
        try {
          if (signal.aborted) {
            abort();
            throw new Error("Storage request cancelled");
          }
          await client.send(
            new PutObjectCommand({
              Bucket: bucket(input.bucket),
              Key: input.key,
              Body: body,
              ContentLength: input.size,
              ContentType: input.mime,
              Metadata: { sha256: input.sha256 },
            }),
            { abortSignal: signal },
          );
        } finally {
          signal.removeEventListener("abort", abort);
          if (!body.destroyed) body.destroy();
        }
      });
    },
    async get(input) {
      const permit = acquire(false, input.signal);
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const result = await client.send(
          new GetObjectCommand({
            Bucket: bucket(input.bucket),
            Key: input.key,
            Range: input.range ? `bytes=${input.range.start}-${input.range.end}` : undefined,
          }),
          { abortSignal: permit.signal },
        );
        if (!result.Body) throw new Error("Missing object body");
        reader = result.Body.transformToWebStream().getReader();
        const head = metadata(result);
        const source = reader;
        let done = false;
        let abort: () => void;
        const finish = () => {
          if (done) return;
          done = true;
          permit.signal.removeEventListener("abort", abort);
          permit.finish();
        };
        const body = new ReadableStream<Uint8Array>(
          {
            start(controller) {
              abort = () => {
                if (done) return;
                controller.error(new Error("Storage read aborted"));
                finish();
                void source.cancel().catch(() => {});
              };
              permit.signal.addEventListener("abort", abort, { once: true });
              if (permit.signal.aborted) abort();
            },
            async pull(controller) {
              try {
                const next = await source.read();
                if (done) return;
                if (next.done) {
                  finish();
                  controller.close();
                } else controller.enqueue(next.value);
              } catch (error) {
                if (!done) {
                  finish();
                  controller.error(error);
                }
              }
            },
            async cancel(reason) {
              finish();
              await source.cancel(reason);
            },
          },
          { highWaterMark: 0 },
        );
        // Stream failure can arrive before a consumer asks for its first chunk.
        void source.closed.catch(() => abort());
        return { ...head, body };
      } catch (error) {
        permit.finish();
        await reader?.cancel().catch(() => {});
        throw error;
      }
    },
    head(input) {
      return request(false, input.signal, async (signal) => {
        try {
          return metadata(
            await client.send(
              new HeadObjectCommand({
                Bucket: bucket(input.bucket),
                Key: input.key,
              }),
              { abortSignal: signal },
            ),
          );
        } catch (error) {
          if (storageStatus(error) === 404) {
            // HEAD has no error body: prove the bucket exists before calling an object missing.
            try {
              await client.send(new HeadBucketCommand({ Bucket: bucket(input.bucket) }), {
                abortSignal: signal,
              });
            } catch (bucketError) {
              if (storageStatus(bucketError) === 404) throw new StorageUnavailableError();
              throw bucketError;
            }
            return null;
          }
          throw error;
        }
      });
    },
    delete: (input) =>
      request(true, input.signal, async (signal) => {
        await client.send(
          new DeleteObjectCommand({
            Bucket: bucket(input.bucket),
            Key: input.key,
          }),
          { abortSignal: signal },
        );
      }),
    copy: (input) =>
      request(true, input.signal, async (signal) => {
        const name = bucket(input.bucket);
        await client.send(
          new CopyObjectCommand({
            Bucket: name,
            Key: input.key,
            CopySource: `${name}/${input.sourceKey.split("/").map(encodeURIComponent).join("/")}`,
            MetadataDirective: "COPY",
          }),
          { abortSignal: signal },
        );
      }),
    list: (input) =>
      request(false, input.signal, async (signal) => {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket(input.bucket),
            Prefix: input.prefix,
            ContinuationToken: input.cursor,
            MaxKeys: 1000,
          }),
          { abortSignal: signal },
        );
        return {
          objects: (page.Contents ?? []).map((item) => {
            if (!item.Key || !Number.isSafeInteger(item.Size) || (item.Size ?? -1) < 0 || !item.LastModified)
              throw new Error("Invalid list metadata");
            return {
              key: item.Key,
              size: item.Size!,
              modifiedAt: item.LastModified,
            };
          }),
          cursor: page.NextContinuationToken,
        };
      }),
    ready: (signal) =>
      request(false, signal, async (requestSignal) => {
        try {
          for (const name of [config.originalBucket, config.derivedBucket])
            await client.send(new HeadBucketCommand({ Bucket: name }), { abortSignal: requestSignal });
        } catch (error) {
          if (storageStatus(error) === 404) throw new StorageUnavailableError();
          throw error;
        }
      }),
  };
  return withStorageCircuitBreaker(raw, { now: options.now });
}
