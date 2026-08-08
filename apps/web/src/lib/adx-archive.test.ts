import { describe, expect, test } from "bun:test";
import { gunzipSync, strFromU8, unzipSync } from "fflate";

import {
  buildArchiveBlob,
  buildNestedArchiveBlob,
  getArchiveDownloadFileName,
  saveBlobAsFile,
  type ArchiveProgress,
} from "./adx-archive";

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function entry(name: string, bytes: Uint8Array | string) {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  return { name, blob: new Blob([data as BlobPart]) };
}

async function bytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

// Built with the local-time constructor because fflate reads the date back
// through local getters, so the packed DOS bytes come out the same in every
// timezone. Any wall-clock-shaped instant works; this one is just readable.
const STAMP = new Date(2026, 7, 8, 14, 30, 0);

/** The DOS mod time+date field (offset 10) of every zip local file header. */
function zipEntryStamps(archive: Uint8Array): Uint8Array[] {
  const stamps: Uint8Array[] = [];
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  for (let offset = 0; offset + 14 <= archive.length; offset += 1) {
    if (view.getUint32(offset, true) === 0x04034b50) {
      stamps.push(archive.subarray(offset + 10, offset + 14));
    }
  }
  return stamps;
}

function tarEntries(tar: Uint8Array): Record<string, Uint8Array> {
  const decoder = new TextDecoder();
  const entries: Record<string, Uint8Array> = {};
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }
    const field = (start: number, length: number) =>
      decoder.decode(header.subarray(start, start + length)).replace(/\0+$/, "");
    const name = field(0, 100);
    const prefix = field(345, 155);
    const sizeText = field(124, 12).trim();
    const size = Number.parseInt(sizeText || "0", 8);
    const dataStart = offset + 512;
    entries[prefix ? `${prefix}/${name}` : name] = tar.subarray(dataStart, dataStart + size);
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

describe("adx archive", () => {
  test("appends the chosen format extension to the directory name", () => {
    expect(getArchiveDownloadFileName("39")).toBe("39.adx");
    expect(getArchiveDownloadFileName("39", "zip")).toBe("39.zip");
    expect(getArchiveDownloadFileName("39", "tar.gz")).toBe("39.tar.gz");
    expect(getArchiveDownloadFileName("[X] 人マニア", "adx")).toBe("[X] 人マニア.adx");
  });

  test("packs files inside the chart directory when a directory name is provided", async () => {
    const blob = await buildArchiveBlob(
      [entry("maidata.txt", "&title=39"), entry("track.mp3", new Uint8Array([1, 2, 3]))],
      "adx",
      "39"
    );

    const entries = unzipSync(await bytes(blob));

    expect(Object.keys(entries).sort()).toEqual(["39/maidata.txt", "39/track.mp3"]);
    expect(strFromU8(entries["39/maidata.txt"])).toBe("&title=39");
  });

  test("adx and zip produce byte-identical archives", async () => {
    const inputs = [entry("maidata.txt", "&title=39"), entry("track.mp3", new Uint8Array([1, 2, 3]))];

    // Both builds are handed the same stamp. Reading the clock twice instead
    // would make this assertion a coin flip whenever the two calls straddle a
    // DOS tick — zip stores mtime at 2-second granularity.
    const adx = await bytes(await buildArchiveBlob(inputs, "adx", undefined, undefined, STAMP));
    const zip = await bytes(await buildArchiveBlob(inputs, "zip", undefined, undefined, STAMP));

    expect(adx).toEqual(zip);
  });

  test("stamps every zip entry from one clock read", async () => {
    // Entries are stamped as they stream, so an archive that takes a while to
    // pack would smear its dates across the run if the clock were read per
    // entry. Local file header: signature at 0, DOS mod time+date at offset 10.
    const blob = await buildArchiveBlob(
      [entry("maidata.txt", "&title=39"), entry("track.mp3", new Uint8Array([1, 2, 3]))],
      "adx",
      undefined,
      undefined,
      STAMP
    );

    const stamps = zipEntryStamps(await bytes(blob));
    expect(stamps).toHaveLength(2); // one local header per entry
    // 2026-08-08 14:30:00 packed as DOS date+time, little-endian.
    expect(stamps[0]).toEqual(new Uint8Array([0xc0, 0x73, 0x08, 0x5d]));
    expect(stamps[1]).toEqual(stamps[0]);
  });

  test("clamps a device clock set before the DOS epoch instead of failing", async () => {
    // fflate rejects an out-of-range DOS year outright, which would turn a
    // skewed clock into a failed download rather than an odd file date.
    const blob = await buildArchiveBlob(
      [entry("maidata.txt", "&title=39")],
      "adx",
      undefined,
      undefined,
      new Date(1970, 0, 1, 12)
    );

    // 1980-01-01 12:00:00, the DOS epoch the clamp falls back to.
    expect(zipEntryStamps(await bytes(blob))[0]).toEqual(
      new Uint8Array([0x00, 0x60, 0x21, 0x00])
    );
  });

  test("reports deterministic archive progress while writing entries", async () => {
    const progress: ArchiveProgress[] = [];
    await buildArchiveBlob(
      [entry("maidata.txt", "&title=39"), entry("track.mp3", new Uint8Array([1, 2, 3]))],
      "adx",
      "39",
      (snapshot) => progress.push({ ...snapshot })
    );

    expect(progress[0]).toEqual({
      completedFiles: 0,
      totalFiles: 2,
      writtenBytes: 0,
      totalBytes: 12,
      currentFile: null,
    });
    expect(progress.some((snapshot) => snapshot.currentFile === "39/maidata.txt")).toBe(true);
    expect(progress.at(-1)).toEqual({
      completedFiles: 2,
      totalFiles: 2,
      writtenBytes: 12,
      totalBytes: 12,
      currentFile: null,
    });
  });

  test("builds a gzip-compressed tar with files inside the chart directory", async () => {
    const blob = await buildArchiveBlob(
      [entry("maidata.txt", "&title=39"), entry("track.mp3", new Uint8Array([1, 2, 3, 4, 5]))],
      "tar.gz",
      "39"
    );

    const tar = gunzipSync(await bytes(blob));

    // tar = N*512 header+data blocks plus two trailing zero blocks; total is 512-aligned.
    expect(tar.length % 512).toBe(0);

    const decoder = new TextDecoder();
    // First header: name at offset 0, ustar magic at 257, size (octal) at 124.
    expect(decoder.decode(tar.subarray(0, 14)).replace(/\0+$/, "")).toBe("39/maidata.txt");
    expect(decoder.decode(tar.subarray(257, 262))).toBe("ustar");
    expect(decoder.decode(tar.subarray(124, 135))).toBe("00000000011"); // 9 bytes = octal 11
    expect(decoder.decode(tar.subarray(512, 521))).toBe("&title=39"); // file data follows header
  });

  test("batch packs chart folders inside the version directory in one adx archive", async () => {
    const blob = await buildNestedArchiveBlob(
      [
        {
          name: "Song A",
          files: [entry("maidata.txt", "&title=A"), entry("track.mp3", new Uint8Array([1, 2, 3]))],
        },
        { name: "Song B", files: [entry("maidata.txt", "&title=B")] },
      ],
      "adx",
      "Version 2026"
    );

    const entries = unzipSync(await bytes(blob));
    expect(Object.keys(entries).sort()).toEqual([
      "Version 2026/Song A/maidata.txt",
      "Version 2026/Song A/track.mp3",
      "Version 2026/Song B/maidata.txt",
    ]);
    expect(strFromU8(entries["Version 2026/Song A/maidata.txt"])).toBe("&title=A");
    expect(strFromU8(entries["Version 2026/Song B/maidata.txt"])).toBe("&title=B");
  });

  test("batch adx and zip produce byte-identical archives", async () => {
    const charts = [
      { name: "Song A", files: [entry("maidata.txt", "&title=A")] },
      { name: "Song B", files: [entry("maidata.txt", "&title=B")] },
    ];

    const adx = await bytes(
      await buildNestedArchiveBlob(charts, "adx", "Version 2026", undefined, STAMP)
    );
    const zip = await bytes(
      await buildNestedArchiveBlob(charts, "zip", "Version 2026", undefined, STAMP)
    );

    expect(adx).toEqual(zip);
  });

  test("batch tar.gz uses chart folders inside the version directory", async () => {
    const blob = await buildNestedArchiveBlob(
      [
        {
          name: "Song A",
          files: [entry("maidata.txt", "&title=A"), entry("track.mp3", new Uint8Array([1, 2, 3]))],
        },
        { name: "Song B", files: [entry("maidata.txt", "&title=B")] },
      ],
      "tar.gz",
      "Version 2026"
    );

    const entries = tarEntries(gunzipSync(await bytes(blob)));
    expect(Object.keys(entries).sort()).toEqual([
      "Version 2026/Song A/maidata.txt",
      "Version 2026/Song A/track.mp3",
      "Version 2026/Song B/maidata.txt",
    ]);
    expect(strFromU8(entries["Version 2026/Song A/maidata.txt"])).toBe("&title=A");
    expect(strFromU8(entries["Version 2026/Song B/maidata.txt"])).toBe("&title=B");
  });

  test("multi-version batch starts at version folders without a collection wrapper", async () => {
    const blob = await buildNestedArchiveBlob(
      [
        {
          groupDir: "25 CiRCLE",
          name: "Same Song",
          files: [entry("maidata.txt", "&title=Circle")],
        },
        {
          groupDir: "24 PRiSM PLUS",
          name: "Same Song",
          files: [entry("maidata.txt", "&title=Prism Plus")],
        },
      ],
      "adx"
    );

    const entries = unzipSync(await bytes(blob));
    expect(Object.keys(entries).sort()).toEqual([
      "24 PRiSM PLUS/Same Song/maidata.txt",
      "25 CiRCLE/Same Song/maidata.txt",
    ]);
    expect(strFromU8(entries["25 CiRCLE/Same Song/maidata.txt"])).toBe("&title=Circle");
    expect(strFromU8(entries["24 PRiSM PLUS/Same Song/maidata.txt"])).toBe(
      "&title=Prism Plus"
    );
  });

  test("batch disambiguates duplicate chart directory names", async () => {
    const blob = await buildNestedArchiveBlob(
      [
        { name: "Dup", files: [entry("maidata.txt", new Uint8Array([1]))] },
        { name: "Dup", files: [entry("maidata.txt", new Uint8Array([2]))] },
      ],
      "zip",
      "Version 2026"
    );

    const entries = unzipSync(await bytes(blob));
    expect(Object.keys(entries).sort()).toEqual([
      "Version 2026/Dup (2)/maidata.txt",
      "Version 2026/Dup/maidata.txt",
    ]);
  });

  test("batch disambiguation keeps sanitized version and chart directory names", async () => {
    const blob = await buildNestedArchiveBlob(
      [
        { name: "Bad/Name", files: [entry("maidata.txt", new Uint8Array([1]))] },
        { name: "Bad/Name", files: [entry("maidata.txt", new Uint8Array([2]))] },
      ],
      "zip",
      "../Version/Name"
    );

    const entries = unzipSync(await bytes(blob));
    expect(Object.keys(entries).sort()).toEqual([
      "_Version_Name/Bad_Name (2)/maidata.txt",
      "_Version_Name/Bad_Name/maidata.txt",
    ]);
  });

  test("sanitizes path separators in archive directory names", async () => {
    const blob = await buildArchiveBlob(
      [entry("maidata.txt", "&title=Unsafe")],
      "adx",
      "../Bad/Name"
    );

    const entries = unzipSync(await bytes(blob));
    expect(Object.keys(entries)).toEqual(["_Bad_Name/maidata.txt"]);
  });

  test("packs nested batch paths, using the USTAR prefix for long ones", async () => {
    const longDir = "x".repeat(110); // forces the >100-byte path into the prefix field
    const blob = await buildArchiveBlob(
      [entry("39/maidata.txt", "&title=39"), entry(`${longDir}/track.mp3`, new Uint8Array([1, 2, 3]))],
      "tar.gz"
    );

    const tar = gunzipSync(await bytes(blob));
    const field = (start: number, length: number) =>
      new TextDecoder().decode(tar.subarray(start, start + length)).replace(/\0+$/, "");

    // Short nested path fits in the 100-byte name field as-is.
    expect(field(0, 100)).toBe("39/maidata.txt");

    // Second entry header is at 1024 (first header 512 + first data padded to 512).
    expect(field(1024, 100)).toBe("track.mp3"); // basename in the name field
    expect(field(1024 + 345, 155)).toBe(longDir); // directory in the USTAR prefix field
  });

  test("creates an object url, clicks a download anchor, and revokes it", async () => {
    const originalDocument = globalThis.document;
    const originalUrl = globalThis.URL;
    const clicked: string[] = [];
    const created: string[] = [];
    const revoked: string[] = [];

    const anchor = {
      href: "",
      download: "",
      click: () => {
        clicked.push(`${anchor.download}:${anchor.href}`);
      },
    };

    globalThis.document = {
      createElement: () => anchor,
    } as unknown as Document;

    globalThis.URL = {
      ...originalUrl,
      createObjectURL: () => {
        created.push("blob:adx-download");
        return "blob:adx-download";
      },
      revokeObjectURL: (url: string) => {
        revoked.push(url);
      },
    } as unknown as typeof URL;

    saveBlobAsFile(new Blob(["archive"]), "39.adx");
    await flushAsyncWork();

    expect(created).toEqual(["blob:adx-download"]);
    expect(clicked).toEqual(["39.adx:blob:adx-download"]);
    expect(revoked).toEqual(["blob:adx-download"]);

    globalThis.document = originalDocument;
    globalThis.URL = originalUrl;
  });
});
