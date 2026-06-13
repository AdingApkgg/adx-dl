import { describe, expect, test } from "bun:test";
import { strFromU8, unzipSync } from "fflate";

import {
  buildAdxArchiveBlob,
  downloadAdxArchiveInputs,
  getAdxDownloadFileName,
  saveBlobAsFile,
} from "./adx-archive";

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("adx archive", () => {
  test("uses the directory name for the .adx download file name", () => {
    expect(getAdxDownloadFileName("39")).toBe("39.adx");
    expect(getAdxDownloadFileName("[X] 人マニア")).toBe("[X] 人マニア.adx");
  });

  test("packs files at the archive root without an extra directory", async () => {
    const blob = await buildAdxArchiveBlob("39", [
      { name: "maidata.txt", bytes: new TextEncoder().encode("&title=39") },
      { name: "track.mp3", bytes: new Uint8Array([1, 2, 3]) },
    ]);

    const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));

    expect(Object.keys(entries).sort()).toEqual(["maidata.txt", "track.mp3"]);
    expect(strFromU8(entries["maidata.txt"])).toBe("&title=39");
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
        { name: "bg.jpg", url: "https://adx-dl.larx.cc/39/bg.jpg" },
        { name: "maidata.txt", url: "https://adx-dl.larx.cc/39/maidata.txt" },
        { name: "track.mp3", url: "https://adx-dl.larx.cc/39/track.mp3" },
      ],
      { concurrency: 2, onProgress: (completed, total) => progress.push([completed, total]) }
    );

    await flushAsyncWork();
    expect(started).toEqual([
      "https://adx-dl.larx.cc/39/bg.jpg",
      "https://adx-dl.larx.cc/39/maidata.txt",
    ]);

    pending.get("https://adx-dl.larx.cc/39/bg.jpg")?.();
    await flushAsyncWork();
    expect(started).toEqual([
      "https://adx-dl.larx.cc/39/bg.jpg",
      "https://adx-dl.larx.cc/39/maidata.txt",
      "https://adx-dl.larx.cc/39/track.mp3",
    ]);

    pending.get("https://adx-dl.larx.cc/39/maidata.txt")?.();
    pending.get("https://adx-dl.larx.cc/39/track.mp3")?.();

    const files = await downloadPromise;

    expect(maxActive).toBe(2);
    expect(files.map((file) => file.name)).toEqual(["bg.jpg", "maidata.txt", "track.mp3"]);
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
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
    } as typeof URL;

    saveBlobAsFile(new Blob(["archive"]), "39.adx");
    await flushAsyncWork();

    expect(created).toEqual(["blob:adx-download"]);
    expect(clicked).toEqual(["39.adx:blob:adx-download"]);
    expect(revoked).toEqual(["blob:adx-download"]);

    globalThis.document = originalDocument;
    globalThis.URL = originalUrl;
  });
});
