import { describe, expect, test } from "bun:test";
import { gunzipSync, strFromU8, unzipSync } from "fflate";

import {
  buildArchiveBlob,
  buildNestedArchiveBlob,
  downloadAdxArchiveInputs,
  getArchiveDownloadFileName,
  saveBlobAsFile,
  type AdxFileProgress,
} from "./adx-archive";

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
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
      { name: "maidata.txt", bytes: new TextEncoder().encode("&title=39") },
      { name: "track.mp3", bytes: new Uint8Array([1, 2, 3]) },
    ]);

    const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));

    expect(Object.keys(entries).sort()).toEqual(["maidata.txt", "track.mp3"]);
    expect(strFromU8(entries["maidata.txt"])).toBe("&title=39");
  });

  test("adx and zip produce byte-identical archives", async () => {
    const inputs = [
      { name: "maidata.txt", bytes: new TextEncoder().encode("&title=39") },
      { name: "track.mp3", bytes: new Uint8Array([1, 2, 3]) },
    ];

    const adx = new Uint8Array(await (await buildArchiveBlob(inputs, "adx")).arrayBuffer());
    const zip = new Uint8Array(await (await buildArchiveBlob(inputs, "zip")).arrayBuffer());

    expect(adx).toEqual(zip);
  });

  test("builds a gzip-compressed tar with files at the root", async () => {
    const blob = await buildArchiveBlob(
      [
        { name: "maidata.txt", bytes: new TextEncoder().encode("&title=39") },
        { name: "track.mp3", bytes: new Uint8Array([1, 2, 3, 4, 5]) },
      ],
      "tar.gz"
    );

    const tar = gunzipSync(new Uint8Array(await blob.arrayBuffer()));

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
          files: [
            { name: "maidata.txt", bytes: new TextEncoder().encode("&title=A") },
            { name: "track.mp3", bytes: new Uint8Array([1, 2, 3]) },
          ],
        },
        {
          name: "Song B",
          files: [{ name: "maidata.txt", bytes: new TextEncoder().encode("&title=B") }],
        },
      ],
      "zip"
    );

    const outer = unzipSync(new Uint8Array(await blob.arrayBuffer()));
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
        { name: "Dup", files: [{ name: "maidata.txt", bytes: new Uint8Array([1]) }] },
        { name: "Dup", files: [{ name: "maidata.txt", bytes: new Uint8Array([2]) }] },
      ],
      "zip"
    );

    const outer = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(outer).sort()).toEqual(["Dup (2).adx", "Dup.adx"]);
  });

  test("packs nested batch paths, using the USTAR prefix for long ones", async () => {
    const longDir = "x".repeat(110); // forces the >100-byte path into the prefix field
    const blob = await buildArchiveBlob(
      [
        { name: "39/maidata.txt", bytes: new TextEncoder().encode("&title=39") },
        { name: `${longDir}/track.mp3`, bytes: new Uint8Array([1, 2, 3]) },
      ],
      "tar.gz"
    );

    const tar = gunzipSync(new Uint8Array(await blob.arrayBuffer()));
    const field = (start: number, length: number) =>
      new TextDecoder().decode(tar.subarray(start, start + length)).replace(/\0+$/, "");

    // Short nested path fits in the 100-byte name field as-is.
    expect(field(0, 100)).toBe("39/maidata.txt");

    // Second entry header is at 1024 (first header 512 + first data padded to 512).
    expect(field(1024, 100)).toBe("track.mp3"); // basename in the name field
    expect(field(1024 + 345, 155)).toBe(longDir); // directory in the USTAR prefix field
  });

  test("downloads files with bounded concurrency and reports progress", async () => {
    const started: string[] = [];
    const progress: Array<[number, number]> = [];
    const pending = new Map<string, () => void>();
    let active = 0;
    let maxActive = 0;

    globalThis.fetch = ((url: string | URL | Request) => {
      const key = String(url);
      started.push(key);
      active += 1;
      maxActive = Math.max(maxActive, active);

      return new Promise<Response>((resolve) => {
        pending.set(key, () => {
          active -= 1;
          resolve(new Response(new TextEncoder().encode(key)));
        });
      });
    }) as typeof fetch;

    const downloadPromise = downloadAdxArchiveInputs(
      [
        { name: "bg.jpg", url: "https://adxcs.saop.cc/39/bg.jpg" },
        { name: "maidata.txt", url: "https://adxcs.saop.cc/39/maidata.txt" },
        { name: "track.mp3", url: "https://adxcs.saop.cc/39/track.mp3" },
      ],
      { concurrency: 2, onProgress: (completed, total) => progress.push([completed, total]) }
    );

    await flushAsyncWork();
    expect(started).toEqual([
      "https://adxcs.saop.cc/39/bg.jpg",
      "https://adxcs.saop.cc/39/maidata.txt",
    ]);

    pending.get("https://adxcs.saop.cc/39/bg.jpg")?.();
    await flushAsyncWork();
    expect(started).toEqual([
      "https://adxcs.saop.cc/39/bg.jpg",
      "https://adxcs.saop.cc/39/maidata.txt",
      "https://adxcs.saop.cc/39/track.mp3",
    ]);

    pending.get("https://adxcs.saop.cc/39/maidata.txt")?.();
    pending.get("https://adxcs.saop.cc/39/track.mp3")?.();

    const files = await downloadPromise;

    expect(maxActive).toBe(2);
    expect(files.map((file) => file.name)).toEqual(["bg.jpg", "maidata.txt", "track.mp3"]);
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  test("streams per-file byte progress and marks each file done", async () => {
    const bodies: Record<string, Uint8Array[]> = {
      "https://adxcs.saop.cc/39/maidata.txt": [
        new Uint8Array([1, 2, 3]),
        new Uint8Array([4, 5]),
      ],
    };

    globalThis.fetch = ((url: string | URL | Request) => {
      const key = String(url);
      const chunks = bodies[key] ?? [];
      const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(chunk);
          }
          controller.close();
        },
      });

      return Promise.resolve(
        new Response(stream, { headers: { "content-length": String(total) } })
      );
    }) as typeof fetch;

    const snapshots: AdxFileProgress[][] = [];

    const files = await downloadAdxArchiveInputs(
      [{ name: "maidata.txt", url: "https://adxcs.saop.cc/39/maidata.txt" }],
      { onFileProgress: (progress) => snapshots.push(progress) }
    );

    expect(files[0].bytes).toEqual(new Uint8Array([1, 2, 3, 4, 5]));

    const last = snapshots.at(-1)?.[0];
    expect(last?.status).toBe("done");
    expect(last?.received).toBe(5);
    expect(last?.total).toBe(5);

    // An intermediate snapshot reports partial bytes against the known total.
    const partial = snapshots.find(
      (snapshot) => snapshot[0].status === "downloading" && snapshot[0].received === 3
    );
    expect(partial?.[0].total).toBe(5);
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
