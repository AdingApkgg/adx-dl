import type { Chart } from "@lxns-network/maimai-chart-engine";
import { afterEach, expect, test, vi } from "vitest";
import { exportPreviewGif } from "@/client/lib/export-preview-gif";

const draws = vi.hoisted(() => ({ frame: vi.fn(), mirror: vi.fn(), resize: vi.fn() }));
vi.mock("@lxns-network/maimai-chart-engine", async importOriginal => {
  const original = await importOriginal<typeof import("@lxns-network/maimai-chart-engine")>();
  return { ...original, MainRenderer: class {
    resizeToSize(...args: number[]) { draws.resize(...args); }
    setJudgmentLineDesign() {} setMirrorMode(mode: string) { draws.mirror(mode); }
    renderFrame(...args: unknown[]) { draws.frame(...args); }
    setIsPlaying() {} setBackgroundImage() {}
  } };
});
const chart: Chart = { title: "Private title", artist: "Private artist", designer: "", bpm: 120,
  level: {}, designers: {}, measures: 2, notes: [],
  bpmEvents: [{ timing: 0, bpm: 120 }, { timing: 4, bpm: 240 }], divisorEvents: [] };
function contextFixture() {
  const pixels = new Uint8ClampedArray(480 * 480 * 4);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    getImageData: () => ({ data: pixels }),
  } as unknown as CanvasRenderingContext2D);
}
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

test("invalid or already cancelled GIF ranges allocate no canvas", async () => {
  const create = vi.spyOn(document, "createElement");
  await expect(exportPreviewGif({ chart, duration: 30, range: { start: 0, end: 16 }, mirror: "none",
    signal: new AbortController().signal, onProgress() {} })).rejects.toBeInstanceOf(RangeError);
  const aborter = new AbortController(); aborter.abort();
  await expect(exportPreviewGif({ chart, duration: 30, range: { start: 0, end: 1 }, mirror: "none",
    signal: aborter.signal, onProgress() {} })).rejects.toMatchObject({ name: "AbortError" });
  expect(create.mock.calls.some(([tag]) => tag === "canvas")).toBe(false);
});

test("real GIF encoding uses variable-BPM chart time and selected mirror at original speed", async () => {
  contextFixture();
  const progress: number[] = [];
  const blob = await exportPreviewGif({ chart, duration: 3, range: { start: 1.9, end: 2.4 }, mirror: "horizontal",
    signal: new AbortController().signal, onProgress(value) { progress.push(value); } });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  expect(new TextDecoder().decode(bytes.subarray(0, 6))).toBe("GIF89a");
  expect(blob.type).toBe("image/gif");
  expect(draws.resize).toHaveBeenCalledWith(480, 1);
  expect(draws.mirror).toHaveBeenCalledWith("horizontal");
  expect(draws.frame).toHaveBeenCalledTimes(10);
  expect(draws.frame.mock.calls[0]?.[1]).toBeCloseTo(3.8);
  expect(draws.frame.mock.calls[9]?.[1]).toBeCloseTo(5.4);
  expect(progress.at(-1)).toBe(1);
  expect(new TextDecoder().decode(bytes)).not.toContain("Private title");
});

test("cancelling between frames frees the canvas and encoder slot for retry", async () => {
  contextFixture();
  const create = vi.spyOn(document, "createElement");
  const aborter = new AbortController();
  await expect(exportPreviewGif({ chart, duration: 3, range: { start: 0, end: 1 }, mirror: "none",
    signal: aborter.signal, onProgress(value) { if (value > 0) aborter.abort(); } })).rejects.toMatchObject({ name: "AbortError" });
  const canvas = create.mock.results.find(row => row.type === "return" && row.value instanceof HTMLCanvasElement)?.value as HTMLCanvasElement;
  expect(canvas.width).toBe(0); expect(canvas.height).toBe(0);
  await expect(exportPreviewGif({ chart, duration: 0.2, range: { start: 0, end: 0.2 }, mirror: "none",
    signal: new AbortController().signal, onProgress() {} })).resolves.toBeInstanceOf(Blob);
});
