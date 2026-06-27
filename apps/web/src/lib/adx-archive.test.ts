import { describe, expect, test } from "bun:test";
import { gunzipSync, strFromU8, unzipSync } from "fflate";

import {
  buildArchiveBlob,
  buildNestedArchiveBlob,
  getArchiveDownloadFileName,
  saveBlobAsFile,
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

describe("adx archive", () => {
  test("appends the chosen format extension to the directory name", () => {
    expect(getArchiveDownloadFileName("39")).toBe("39.adx");
    expect(getArchiveDownloadFileName("39", "zip")).toBe("39.zip");
    expect(getArchiveDownloadFileName("39", "tar.gz")).toBe("39.tar.gz");
    expect(getArchiveDownloadFileName("[X] 人マニア", "adx")).toBe("[X] 人マニア.adx");
  });

  test("packs files at the archive root without an extra directory", async () => {
    const blob = await buildArchiveBlob([
      entry("maidata.txt", "&title=39"),
      entry("track.mp3", new Uint8Array([1, 2, 3])),
    ]);

    const entries = unzipSync(await bytes(blob));

    expect(Object.keys(entries).sort()).toEqual(["maidata.txt", "track.mp3"]);
    expect(strFromU8(entries["maidata.txt"])).toBe("&title=39");
  });

  test("adx and zip produce byte-identical archives", async () => {
    const inputs = [entry("maidata.txt", "&title=39"), entry("track.mp3", new Uint8Array([1, 2, 3]))];

    const adx = await bytes(await buildArchiveBlob(inputs, "adx"));
    const zip = await bytes(await buildArchiveBlob(inputs, "zip"));

    expect(adx).toEqual(zip);
  });

  test("builds a gzip-compressed tar with files at the root", async () => {
    const blob = await buildArchiveBlob(
      [entry("maidata.txt", "&title=39"), entry("track.mp3", new Uint8Array([1, 2, 3, 4, 5]))],
      "tar.gz"
    );

    const tar = gunzipSync(await bytes(blob));

    // tar = N*512 header+data blocks plus two trailing zero blocks; total is 512-aligned.
    expect(tar.length % 512).toBe(0);

    const decoder = new TextDecoder();
    // First header: name at offset 0, ustar magic at 257, size (octal) at 124.
    expect(decoder.decode(tar.subarray(0, 11)).replace(/\0+$/, "")).toBe("maidata.txt");
    expect(decoder.decode(tar.subarray(257, 262))).toBe("ustar");
    expect(decoder.decode(tar.subarray(124, 135))).toBe("00000000011"); // 9 bytes = octal 11
    expect(decoder.decode(tar.subarray(512, 521))).toBe("&title=39"); // file data follows header
  });

  test("batch packs one .adx per chart inside an outer zip", async () => {
    const blob = await buildNestedArchiveBlob(
      [
        {
          name: "Song A",
          files: [entry("maidata.txt", "&title=A"), entry("track.mp3", new Uint8Array([1, 2, 3]))],
        },
        { name: "Song B", files: [entry("maidata.txt", "&title=B")] },
      ],
      "zip"
    );

    const outer = unzipSync(await bytes(blob));
    expect(Object.keys(outer).sort()).toEqual(["Song A.adx", "Song B.adx"]);

    // Each entry is itself a zip with the chart's files at the root.
    const adxA = unzipSync(outer["Song A.adx"]);
    expect(Object.keys(adxA).sort()).toEqual(["maidata.txt", "track.mp3"]);
    expect(strFromU8(adxA["maidata.txt"])).toBe("&title=A");

    const adxB = unzipSync(outer["Song B.adx"]);
    expect(Object.keys(adxB)).toEqual(["maidata.txt"]);
  });

  test("batch disambiguates duplicate chart directory names", async () => {
    const blob = await buildNestedArchiveBlob(
      [
        { name: "Dup", files: [entry("maidata.txt", new Uint8Array([1]))] },
        { name: "Dup", files: [entry("maidata.txt", new Uint8Array([2]))] },
      ],
      "zip"
    );

    const outer = unzipSync(await bytes(blob));
    expect(Object.keys(outer).sort()).toEqual(["Dup (2).adx", "Dup.adx"]);
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
