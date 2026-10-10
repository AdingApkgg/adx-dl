import type {
  StorageContext,
  StorageJobData,
  ObjectBucket,
} from "../server/storage/contracts";
import {
  claimAvatarRecipe,
  claimAvatarOutput,
  publishAvatarOutput,
  withProcessingUpload,
} from "../server/storage/objects";
import { checkStorageDisk } from "../server/storage/usage";
import { rejectUpload } from "../server/storage/uploads";
import { RECIPE_BUILD } from "./image-child";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { mkdtemp, open, rm, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { StorageError } from "../server/storage/errors";
import { CHILD_ERRORS } from "./image-child";
let childRunning = false;
/** One owned process, hard wall deadline; capacity is held until SIGKILL has actually reaped it. */
export async function processAvatar(
  inputPath: string,
  outputPath: string,
  signal?: AbortSignal,
  onChildState?: (state: "started" | "reaped") => void,
): Promise<{
  hash: string;
  size: number;
  width: 512;
  height: 512;
  mime: "image/jpeg";
}> {
  signal?.throwIfAborted();
  if (childRunning)
    throw new StorageError(503, "STORAGE_BUSY", "STORAGE_BUSY", 1);
  childRunning = true;
  let success = false;
  let timedOut = false;
  let child: ReturnType<typeof Bun.spawn> | undefined;
  const kill = () => child?.kill("SIGKILL");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    child = Bun.spawn({
      cmd: [
        process.execPath,
        fileURLToPath(new URL("./image-child.ts", import.meta.url)),
        inputPath,
        outputPath,
      ],
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    onChildState?.("started");
    timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, 30000);
    signal?.addEventListener("abort", kill, { once: true });
    if (signal?.aborted) kill();
    const code = await child.exited;
    onChildState?.("reaped");
    signal?.throwIfAborted();
    if (timedOut) throw new StorageError(503, "PROCESSING_FAILED");
    if (code !== 0)
      throw new StorageError(
        code >= 20 && code < 25 ? 400 : 503,
        CHILD_ERRORS[code - 20] ?? "PROCESSING_FAILED",
      );
    const size = (await stat(outputPath)).size;
    if (size < 1 || size > 524288)
      throw new StorageError(400, "IMAGE_TOO_LARGE");
    const hash = createHash("sha256");
    for await (const bytes of Bun.file(outputPath).stream()) hash.update(bytes);
    success = true;
    return {
      hash: hash.digest("hex"),
      size,
      width: 512,
      height: 512,
      mime: "image/jpeg",
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", kill);
    try {
      if (!success) await rm(outputPath, { force: true });
    } finally {
      childRunning = false;
    }
  }
}

/** Reads bounded bytes to disk and authenticates the actual stream, including recovery after uncertain PUT. */
async function copyVerified(
  ctx: StorageContext,
  bucket: ObjectBucket,
  key: string,
  path: string,
  size: number,
  hash: string,
  signal: AbortSignal,
) {
  const file = await open(path, "wx", 0o600);
  const digest = createHash("sha256");
  let total = 0;
  try {
    const object = await ctx.driver.get({ bucket, key, signal });
    const reader = object.body.getReader();
    try {
      while (true) {
        signal.throwIfAborted();
        const { value, done } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > size) throw new StorageError(503, "STORAGE_INCONSISTENT");
        digest.update(value);
        let offset = 0;
        while (offset < value.length) {
          const { bytesWritten } = await file.write(
            value,
            offset,
            value.length - offset,
          );
          if (!bytesWritten) throw new StorageError(503, "STORAGE_UNAVAILABLE");
          offset += bytesWritten;
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    if (total !== size || digest.digest("hex") !== hash)
      throw new StorageError(503, "STORAGE_INCONSISTENT");
  } finally {
    await file.close();
  }
}
let deriving = false;
const permanent = new Set([
  "IMAGE_INVALID",
  "IMAGE_TOO_LARGE",
  "ANIMATED_IMAGE_NOT_ALLOWED",
  "TYPE_NOT_ALLOWED",
  "FILE_TOO_LARGE",
  "HASH_BLOCKED",
  "UPLOAD_EXPIRED",
  "PURPOSE_NOT_AVAILABLE",
]);
export async function deriveAvatar(
  ctx: StorageContext,
  data: StorageJobData,
): Promise<void> {
  if (ctx.config.recipeBuild !== RECIPE_BUILD)
    throw new StorageError(503, "STORAGE_INCONSISTENT");
  if (deriving) throw new StorageError(503, "STORAGE_BUSY", "STORAGE_BUSY", 1);
  deriving = true;
  let directory: string | undefined;
  try {
    const source = await claimAvatarRecipe(ctx, data);
    if (!source || source.recipe.state === "ready") return;
    if (source.blob.size > 8388608)
      throw new StorageError(413, "FILE_TOO_LARGE");
    await checkStorageDisk(ctx);
    directory = await mkdtemp(join(ctx.config.tempDir, "avatar-"));
    const signal = ctx.lifecycle ? AbortSignal.any([ctx.lifecycle.signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000);
    const input = join(directory, "input"),
      outputPath = join(directory, "output.jpg");
    await copyVerified(
      ctx,
      "original",
      source.blob.key,
      input,
      source.blob.size,
      source.blob.sha256,
      signal,
    );
    const output = await processAvatar(input, outputPath, signal);
    const claim = await claimAvatarOutput(ctx, data, source, output);
    if (!claim || claim.kind === "ready") return;
    const object = claim.object;
    const existing = await ctx.driver.head({
      bucket: "derived",
      key: object.key,
      signal,
    });
    if (existing) {
      await copyVerified(
        ctx,
        "derived",
        object.key,
        join(directory, "recovered"),
        output.size,
        output.hash,
        signal,
      );
    } else {
      await ctx.driver.put({
        bucket: "derived",
        key: object.key,
        body: Bun.file(outputPath).stream(),
        size: output.size,
        mime: output.mime,
        sha256: output.hash,
        signal,
      });
    }
    const head = await ctx.driver.head({
      bucket: "derived",
      key: object.key,
      signal,
    });
    if (
      !head ||
      head.size !== output.size ||
      head.sha256 !== output.hash ||
      head.mime !== output.mime
    )
      throw new StorageError(503, "STORAGE_INCONSISTENT");
    if (
      !(await publishAvatarOutput(ctx, data, source, claim)) &&
      (await withProcessingUpload(ctx, data, async () => true))
    )
      throw new StorageError(503, "STORAGE_BUSY", "STORAGE_BUSY", 30);
  } catch (error) {
    if (error instanceof StorageError && permanent.has(error.code)) {
      await rejectUpload(ctx, data, error.code);
      return;
    }
    throw error;
  } finally {
    try {
      if (directory) await rm(directory, { recursive: true, force: true });
    } finally {
      deriving = false;
    }
  }
}
