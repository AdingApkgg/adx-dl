import { afterEach, describe, expect, test } from "bun:test";
import { unzipSync } from "fflate";
import { createMemoryArchiveStorage } from "./archive-storage.test-helper";
import { releaseArchiveBlob } from "./adx-archive-storage";
import { buildArchiveBlob } from "./adx-archive";

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
afterEach(() => {
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
  else Reflect.deleteProperty(globalThis, "navigator");
});

function storageFixture(failWrite = false) {
  const fixture = createMemoryArchiveStorage(failWrite);
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { storage: fixture.storage } });
  return fixture;
}
const input = [{ name: "谱面/maidata.txt", blob: new Blob(["&title=BGA"]) }];
async function textIn(blob: Blob) {
  return new TextDecoder().decode(unzipSync(new Uint8Array(await blob.arrayBuffer()))[input[0].name]);
}

describe("archive storage", () => {
  test("buffered policy does not retry disk storage already rejected by capability planning", async () => {
    const storage = storageFixture();
    const archive = await buildArchiveBlob(input, "adx", undefined, undefined, undefined, {useDisk: false});
    expect(archive).not.toBeInstanceOf(File);
    expect(storage.files.size).toBe(0);
    expect(await textIn(archive)).toBe("&title=BGA");
  });

  test("a browser denying access to StorageManager still permits bounded downloads", async () => {
    storageFixture();
    Object.defineProperty(navigator, "storage", {get() {throw new DOMException("Storage denied", "SecurityError");}});
    expect(await textIn(await buildArchiveBlob(input))).toBe("&title=BGA");
  });

  test("a required disk output fails for repartitioning instead of constructing an unbounded fallback Blob", async () => {
    const storage = storageFixture(true);
    await expect(buildArchiveBlob(input, "adx", undefined, undefined, undefined,
      { requireDisk: true })).rejects.toMatchObject({ name: "ArchiveStorageUnavailableError" });
    expect(storage.files.size).toBe(0);
    expect(storage.removed).toHaveLength(1);
  });

  test("supported storage returns a disk-backed File containing the same Unicode chart", async () => {
    const storage = storageFixture();
    const archive = await buildArchiveBlob(input);
    expect(archive).toBeInstanceOf(File);
    expect(storage.files.size).toBe(1);
    expect(await textIn(archive)).toBe("&title=BGA");
  });

  test("quota failure removes the partial disk file and rebuilds a readable Blob", async () => {
    const storage = storageFixture(true);
    const archive = await buildArchiveBlob(input);
    expect(await textIn(archive)).toBe("&title=BGA");
    expect(storage.files.size).toBe(0);
    expect(storage.removed).toHaveLength(1);
  });

  test("an aborted pack never starts a disk write or falls back to a Blob", async () => {
    const storage = storageFixture();
    const controller = new AbortController();
    controller.abort();
    await expect(buildArchiveBlob(input, "adx", undefined, undefined, undefined,
      { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(storage.files.size).toBe(0);
  });
  test("releasing a prepared archive deletes its temporary file exactly once", async () => {
    const storage = storageFixture();
    const archive = await buildArchiveBlob(input);
    await releaseArchiveBlob(archive);
    await releaseArchiveBlob(archive);
    expect(storage.files.size).toBe(0);
    expect(storage.removed).toHaveLength(1);
  });

  test("insufficient estimated space falls back without allocating a temporary file", async () => {
    const storage = storageFixture();
    storage.storage.estimate = async () => ({ quota: 1, usage: 0 });
    const archive = await buildArchiveBlob(input);
    expect(await textIn(archive)).toBe("&title=BGA");
    expect(storage.files.size).toBe(0);
    expect(storage.removed).toHaveLength(0);
  });

  test("cancel during packing removes the partial file without rebuilding", async () => {
    const storage = storageFixture();
    const controller = new AbortController();
    await expect(buildArchiveBlob([{ name: "pv.mp4", blob: new Blob([new Uint8Array(8 * 1024 * 1024)]) }],
      "adx", undefined, ({ writtenBytes }) => { if (writtenBytes > 0) controller.abort(); },
      undefined, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(storage.files.size).toBe(0);
    expect(storage.removed).toHaveLength(1);
  });

  test("cancel while obtaining the completed file still releases disk storage", async () => {
    const storage = storageFixture();
    const controller = new AbortController();
    const getDirectory = storage.storage.getDirectory;
    storage.storage.getDirectory = async () => {
      const root = await getDirectory();
      const directory = await root.getDirectoryHandle();
      const getFileHandle = directory.getFileHandle;
      directory.getFileHandle = async (name) => {
        const handle = await getFileHandle(name);
        const getFile = handle.getFile;
        handle.getFile = async () => { controller.abort(); return getFile(); };
        return handle;
      };
      return root;
    };
    await expect(buildArchiveBlob(input, "adx", undefined, undefined, undefined,
      { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(storage.files.size).toBe(0);
    expect(storage.removed).toHaveLength(1);
  });

});
