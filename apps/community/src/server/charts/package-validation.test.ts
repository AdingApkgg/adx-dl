import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { inspectChartPackage } from "./package-validation";
import { readChartArtifactManifest, validateChartPreviewManifest } from "./artifact";

// A deliberately small ZIP writer keeps malformed central-directory fixtures explicit.
type ZipFixture = { name: string; bytes: Buffer; crc?: number; method?: number; external?: number; declaredSize?: number; disk?: number };
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries: ZipFixture[]): Buffer {
  const locals: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), method = entry.method ?? 0;
    const data = method === 8 ? deflateRawSync(entry.bytes) : entry.bytes;
    const crc = entry.crc ?? crc32(entry.bytes), size = entry.declaredSize ?? entry.bytes.length;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(method, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(size, 22); local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);
    const record = Buffer.alloc(46); record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(0x314, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(0x800, 8); record.writeUInt16LE(method, 10); record.writeUInt32LE(crc, 16); record.writeUInt32LE(data.length, 20); record.writeUInt32LE(size, 24); record.writeUInt16LE(name.length, 28); record.writeUInt16LE(entry.disk ?? 0, 34); record.writeUInt32LE(entry.external ?? 0, 38); record.writeUInt32LE(offset, 42); central.push(record, name); offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
const maidata = Buffer.from("&title=Fixture\n&inote_4=(120){4}1,2,E\n");
const directories: string[] = [];
async function fixture(entries: ZipFixture[]) {
  const directory = await mkdtemp(join(tmpdir(), "adxc-chart-package-test-")); directories.push(directory);
  const input = join(directory, "input.zip"), output = join(directory, "preview"); await writeFile(input, zip(entries));
  return { input, output };
}
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
async function reject(entries: ZipFixture[], code: string) {
  const { input, output } = await fixture(entries);
  try { await inspectChartPackage(input, output); throw new Error("expected rejection"); }
  catch (error) { expect((error as { code: string }).code).toBe(code); }
}
describe("bounded private chart ZIP", () => {
  test("stored and deflated inputs produce deterministic artifact metadata", async () => {
    const a = await fixture([{ name: "wrapped/maidata.txt", bytes: maidata }, { name: "wrapped/.DS_Store", bytes: Buffer.from("ignored") }]);
    const b = await fixture([{ name: "maidata.txt", bytes: maidata, method: 8 }]);
    const first = await inspectChartPackage(a.input, a.output), second = await inspectChartPackage(b.input, b.output);
    expect(first.artifact.sha256).toBe(second.artifact.sha256);
    expect(first.summary.difficulties[0].noteCount).toBe(2);
    expect(first.summary.warnings).toContainEqual({ code: "AUDIO_MISSING" });
    const decoded = await readChartArtifactManifest(a.output);
    expect(decoded.manifest).toEqual(first.manifest);
    expect((await readFile(a.output)).subarray(decoded.dataStart)).toEqual(maidata);
  });
  test.each(["../maidata.txt", "a//maidata.txt", "a/./maidata.txt", "C:/maidata.txt", "a\\maidata.txt"]) ("rejects unsafe paths %s", async (name) => reject([{ name, bytes: maidata }], "CHART_PATH_INVALID"));
  test("rejects NFC/case collision, symlink and competing chart directories", async () => {
    await reject([{ name: "maidata.txt", bytes: maidata }, { name: "MAIDATA.TXT", bytes: maidata }], "CHART_PATH_COLLISION");
    await reject([{ name: "maidata.txt", bytes: maidata, external: (0o120777 << 16) >>> 0 }], "CHART_ARCHIVE_UNSUPPORTED");
    await reject([{ name: "one/maidata.txt", bytes: maidata }, { name: "two/track.mp3", bytes: Buffer.from("x") }], "CHART_PACKAGE_INVALID");
  });
  test("checks CRC and actual expansion of unselected entries too", async () => {
    await reject([{ name: "maidata.txt", bytes: maidata }, { name: ".DS_Store", bytes: Buffer.from("ignored"), crc: 123 }], "CHART_PACKAGE_INVALID");
    await reject([{ name: "maidata.txt", bytes: maidata }, { name: "ignored.bin", bytes: Buffer.from("expanded"), method: 8, declaredSize: 1 }], "CHART_PACKAGE_INVALID");
  });
  test("counts directories, rejects ambiguous assets and observes cancellation", async () => {
    await reject([...Array.from({ length: 128 }, (_, i) => ({ name: `dir${i}/`, bytes: Buffer.alloc(0) })), { name: "maidata.txt", bytes: maidata }], "CHART_ENTRY_LIMIT");
    await reject([{ name: "maidata.txt", bytes: maidata }, { name: "track.mp3", bytes: Buffer.from("x") }, { name: "track.ogg", bytes: Buffer.from("x") }], "CHART_ASSET_AMBIGUOUS");
    const { input, output } = await fixture([{ name: "maidata.txt", bytes: maidata }]);
    await expect(inspectChartPackage(input, output, AbortSignal.abort())).rejects.toThrow();
  });
  test("sniffs bounded WAV, preserves bytes, and validates asset segmentation", async () => {
    const wav = Buffer.alloc(46); wav.write("RIFF", 0); wav.writeUInt32LE(38, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(2, 40);
    const { input, output } = await fixture([{ name: "maidata.txt", bytes: maidata }, { name: "track.wav", bytes: wav }]);
    const result = await inspectChartPackage(input, output);
    expect(result.summary.audio).toEqual({ mime: "audio/wav", size: 46 });
    const audio = result.manifest.assets[1];
    expect(audio.offset).toBe(maidata.length);
    expect(() => validateChartPreviewManifest({ ...result.manifest, assets: [{ ...result.manifest.assets[0], offset: 1 }, audio] }, result.artifact.size)).toThrow();
    expect(() => validateChartPreviewManifest(result.manifest, result.artifact.size + 1)).toThrow();
    await reject([{ name: "maidata.txt", bytes: maidata }, { name: "track.mp3", bytes: wav }], "CHART_ASSET_INVALID");
  });
  test("cancels during actual extraction and removes every owned selected scratch file", async () => {
    const { input, output } = await fixture([{ name: "maidata.txt", bytes: maidata }, { name: "track.mp3", bytes: Buffer.alloc(4 * 1024 * 1024), method: 8 }]);
    const controller = new AbortController(); let interruptedExtraction = false;
    const timer = setInterval(async () => {
      try {
        const names = await readdir(join(input, "..")), scratch = names.find((name) => name.startsWith(".chart-selected-"));
        if (scratch && (await stat(join(input, "..", scratch, "audio"))).size > 0) { interruptedExtraction = true; controller.abort(new Error("cancelled by owner")); }
      } catch { /* The target only exists while the owned extraction is running. */ }
    }, 1);
    try { await expect(inspectChartPackage(input, output, controller.signal)).rejects.toThrow("cancelled by owner"); }
    finally { clearInterval(timer); }
    expect(interruptedExtraction).toBe(true);
    expect((await readdir(join(input, ".."))).filter((name) => name.startsWith(".chart-selected-"))).toEqual([]);
    await expect(stat(output)).rejects.toThrow();
  });
  test("rejects the central disk-start field even when the EOCD claims a single disk", async () => {
    await reject([{ name: "maidata.txt", bytes: maidata, disk: 1 }], "CHART_ARCHIVE_UNSUPPORTED");
  });
});
