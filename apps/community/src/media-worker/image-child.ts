import { open, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { StorageError } from "../server/storage/errors";

sharp.concurrency(1);
sharp.cache(false);
export const RECIPE_BUILD = `avatar-v1.sharp-${sharp.versions.sharp}.vips-${sharp.versions.vips}.rotate-srgb-cover512-centre-white-jpeg85-baseline-strip.container-v1`;
const invalid = () => new StorageError(400, "IMAGE_INVALID");
const animated = () => new StorageError(400, "ANIMATED_IMAGE_NOT_ALLOWED");
/** Header allocation/read budget is 4096 bytes. PNG payloads are skipped with positional reads. */
export async function inspectContainer(
  path: string,
): Promise<"jpeg" | "png" | "webp" | "heif"> {
  const file = await open(path, "r");
  try {
    const size = (await file.stat()).size;
    if (size < 1 || size > 8388608)
      throw new StorageError(413, "FILE_TOO_LARGE");
    const head = Buffer.alloc(Math.min(size, 4096));
    const initial = Math.min(size, 16);
    if ((await file.read(head, 0, initial, 0)).bytesRead !== initial)
      throw invalid();
    if (
      head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ) {
      let offset = 8;
      let inspected = initial;
      let first = true;
      const header = Buffer.alloc(8);
      while (offset + 12 <= size && inspected + 8 <= 4096) {
        if ((await file.read(header, 0, 8, offset)).bytesRead !== 8)
          throw invalid();
        inspected += 8;
        const length = header.readUInt32BE(0);
        const type = header.toString("ascii", 4, 8);
        if (first && (type !== "IHDR" || length !== 13)) throw invalid();
        first = false;
        if (offset + 12 + length > size) throw invalid();
        if (type === "acTL") throw animated();
        offset += 12 + length;
        if (type === "IEND") {
          if (length !== 0 || offset !== size) throw invalid();
          return "png";
        }
      }
      throw invalid();
    }
    if (head[0] === 255 && head[1] === 216 && head[2] === 255) return "jpeg";
    if (
      head.toString("ascii", 0, 4) === "RIFF" &&
      head.toString("ascii", 8, 12) === "WEBP"
    )
      return "webp";
    if (head.toString("ascii", 4, 8) === "ftyp") {
      if (head.length < 16) throw invalid();
      const short = head.readUInt32BE(0);
      const start = short === 1 ? 16 : 8;
      const length = short === 1 ? head.readBigUInt64BE(8) : BigInt(short);
      if (
        length < BigInt(start + 8) ||
        length > BigInt(head.length) ||
        length > 4096n ||
        (length - BigInt(start)) % 4n !== 0n
      )
        throw invalid();
      if (
        Number(length) > initial &&
        (await file.read(head, initial, Number(length) - initial, initial))
          .bytesRead !==
          Number(length) - initial
      )
        throw invalid();
      const brands = [head.toString("ascii", start, start + 4)];
      for (let p = start + 8; p < Number(length); p += 4)
        brands.push(head.toString("ascii", p, p + 4));
      if (brands.includes("avis")) throw animated();
      if (brands.includes("avif")) return "heif";
      throw new StorageError(400, "TYPE_NOT_ALLOWED");
    }
    throw new StorageError(400, "TYPE_NOT_ALLOWED");
  } finally {
    await file.close();
  }
}
export async function renderAvatar(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  const format = await inspectContainer(inputPath);
  let output: Buffer;
  try {
    const image = sharp(inputPath, {
      failOn: "warning",
      limitInputPixels: 16000000,
    });
    const meta = await image.metadata();
    if (
      meta.format !== format ||
      (format === "heif" && meta.compression !== "av1")
    )
      throw new StorageError(400, "TYPE_NOT_ALLOWED");
    if ((meta.pages ?? 1) !== 1) throw animated();
    if (!meta.width || !meta.height) throw invalid();
    if (
      meta.width > 8192 ||
      meta.height > 8192 ||
      meta.width * meta.height > 16000000
    )
      throw new StorageError(400, "IMAGE_TOO_LARGE");
    output = await image
      .rotate()
      .toColourspace("srgb")
      .resize(512, 512, { fit: "cover", position: "centre" })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85, progressive: false })
      .toBuffer();
    if (output.length > 524288)
      throw new StorageError(400, "IMAGE_TOO_LARGE");
  } catch (error) {
    if (error instanceof StorageError) throw error;
    if (error instanceof Error && error.message.includes("pixel limit"))
      throw new StorageError(400, "IMAGE_TOO_LARGE");
    throw invalid();
  }
  // The child encodes only a fixed 512×512 RGB raster. General originals stay
  // disk-backed; this small derived buffer is checked before any disk write.
  // Filesystem failures escape separately and become retryable PROCESSING_FAILED.
  await writeFile(outputPath, output, {mode: 0o600});
}
export const CHILD_ERRORS = [
  "IMAGE_INVALID",
  "IMAGE_TOO_LARGE",
  "ANIMATED_IMAGE_NOT_ALLOWED",
  "TYPE_NOT_ALLOWED",
  "FILE_TOO_LARGE",
] as const;
if (import.meta.main) {
  try {
    await renderAvatar(process.argv[2], process.argv[3]);
  } catch (error) {
    const index =
      error instanceof StorageError
        ? CHILD_ERRORS.indexOf(error.code as (typeof CHILD_ERRORS)[number])
        : -1;
    process.exit(index < 0 ? 1 : 20 + index);
  }
}
