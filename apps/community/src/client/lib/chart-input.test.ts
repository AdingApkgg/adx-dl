import { expect, test } from "bun:test";
import { unzipSync } from "fflate";
import { chartFolderEntries, packChartFolder } from "./chart-input";
import * as chartInput from "./chart-input";
const file = (name: string) => {
  const input = new File(["x"], name);
  Object.defineProperty(input, "webkitRelativePath", { value: name });
  return input;
};
test("folder packaging validates normalized paths and uses a stable order", () => {
  expect(chartFolderEntries([file("track.mp3"), file("maidata.txt")]).map((row) => row.path)).toEqual(["maidata.txt", "track.mp3"]);
  expect(() => chartFolderEntries([file("../maidata.txt")])).toThrow();
  expect(() => chartFolderEntries([file("a\\b")])).toThrow();
  for (const code of [0, 31, 127]) expect(() => chartFolderEntries([file(`a${String.fromCharCode(code)}b.txt`)])).toThrow();
  expect(chartFolderEntries([file("a b.txt")])[0]?.path).toBe("a b.txt");
  expect(() => chartFolderEntries([file("é.txt"), file("e\u0301.txt")])).toThrow();
  expect(() => chartFolderEntries([file("A.txt"), file("a.txt")])).toThrow();
  expect(() => chartFolderEntries(Array.from({ length: 129 }, (_, index) => file(`${index}.txt`)))).toThrow();
});

test("folder input without directory paths is rejected with the ZIP fallback", () => {
  expect(() => chartFolderEntries([new File(["x"], "maidata.txt")])).toThrow("Choose a ZIP");
});

test("cancelling folder packaging terminates its Worker and ignores late ZIP output", async () => {
  const original = globalThis.Worker;
  let instance: { terminated: boolean; onmessage: ((event: { data: unknown }) => void) | null };
  class FolderWorker {
    terminated = false;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror = null;
    constructor() { instance = this; }
    postMessage() {}
    terminate() { this.terminated = true; }
  }
  globalThis.Worker = FolderWorker as unknown as typeof Worker;
  try {
    const aborter = new AbortController();
    const result = packChartFolder([file("maidata.txt")], aborter.signal);
    aborter.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(instance!.terminated).toBe(true);
    instance!.onmessage?.({ data: { zip: new ArrayBuffer(1) } });
  } finally { globalThis.Worker = original; }
});

test("real folder Worker produces STORED entries with the original names and bytes", async () => {
  const maidata = new TextEncoder().encode("&title=Test\n&inote_4=(120){4}1,2,3,E\n");
  const audio = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 1, 255, 128, 2]);
  const input = (path: string, bytes: Uint8Array) => {
    const file = new File([new Uint8Array(bytes)], path.split("/").at(-1)!);
    Object.defineProperty(file, "webkitRelativePath", { value: path });
    return file;
  };
  const aborter = new AbortController();
  const timer = setTimeout(() => aborter.abort(), 10_000);
  try {
    // packChartFolder starts the actual Worker module; fflate is not mocked.
    const output = await packChartFolder([input("chart/track.ogg", audio), input("chart/maidata.txt", maidata)], aborter.signal);
    const bytes = new Uint8Array(await output.arrayBuffer());
    const unpacked = unzipSync(bytes);
    expect(Object.keys(unpacked)).toEqual(["chart/maidata.txt", "chart/track.ogg"]);
    expect(Array.from(unpacked["chart/maidata.txt"]!)).toEqual(Array.from(maidata));
    expect(Array.from(unpacked["chart/track.ogg"]!)).toEqual(Array.from(audio));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const end = bytes.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    let offset = view.getUint32(end + 16, true);
    const names: string[] = [];
    for (let index = 0; index < 2; index++) {
      expect(view.getUint32(offset, true)).toBe(0x02014b50);
      expect(view.getUint16(offset + 10, true)).toBe(0); // STORED, never DEFLATE.
      const nameSize = view.getUint16(offset + 28, true);
      names.push(new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameSize)));
      offset += 46 + nameSize + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    }
    expect(names).toEqual(["chart/maidata.txt", "chart/track.ogg"]);
    expect(offset).toBe(end);
  } finally { clearTimeout(timer); aborter.abort(); }
}, 15_000);


test("loose chart parts package canonical names and original bytes deterministically in the real Worker", async () => {
  const parts = {
    maidata: new File(["&title=Loose\n&inote_4=(120){4}1,2,E\n"], "my score.txt"),
    audio: new File([new Uint8Array([79, 103, 103, 83, 0, 255])], "song.OGG"),
    cover: new File([new Uint8Array([137, 80, 78, 71])], "art.PNG"),
    video: new File([new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])], "movie.mp4"),
  };
  const first = await chartInput.packChartParts(parts);
  const second = await chartInput.packChartParts(parts);
  expect(first.name).toBe("chart.zip");
  const bytes = new Uint8Array(await first.arrayBuffer());
  expect(bytes).toEqual(new Uint8Array(await second.arrayBuffer()));
  const entries = unzipSync(bytes);
  expect(Object.keys(entries)).toEqual(["bg.png", "maidata.txt", "pv.mp4", "track.ogg"]);
  expect(new TextDecoder().decode(entries["maidata.txt"])).toBe("&title=Loose\n&inote_4=(120){4}1,2,E\n");
  expect([...entries["track.ogg"]!]).toEqual([79, 103, 103, 83, 0, 255]);
  expect([...entries["bg.png"]!]).toEqual([137, 80, 78, 71]);
  expect([...entries["pv.mp4"]!]).toEqual([0, 0, 0, 24, 102, 116, 121, 112]);
});

test("loose parts reject missing score, wrong role type and oversized source before packaging", () => {
  expect(() => chartInput.packChartParts({ audio: new File(["audio"], "song.mp3") })).toThrow();
  expect(() => chartInput.packChartParts({ maidata: new File(["text"], "score.exe") })).toThrow();
  expect(() => chartInput.packChartParts({ maidata: new File(["text"], "score.txt"), audio: new File(["x"], "song.flac") })).toThrow();
  const large = new File(["x"], "movie.mp4");
  Object.defineProperty(large, "size", { value: 64 * 1024 * 1024 + 1 });
  expect(() => chartInput.packChartParts({ maidata: new File(["text"], "score.txt"), video: large })).toThrow();
});


test("an empty loose asset has an actionable empty-file error rather than a size-limit error", () => {
  let failure: unknown;
  try { chartInput.packChartParts({ maidata: new File([], "empty.txt") }); } catch (error) { failure = error; }
  expect(failure).toMatchObject({ code: "CHART_PART_EMPTY" });
});
