import { MainRenderer, TimingTimeline, type Chart, type MirrorMode } from "@lxns-network/maimai-chart-engine";
import { GIFEncoder, applyPalette, quantize } from "gifenc";
import { GIF_FPS, GIF_SIZE, MAX_GIF_BYTES, gifFrameCount, type PreviewRange } from "./chart-preview-practice";

// Serialize encoders across two simultaneously mounted previews. No queue keeps private charts alive.
let encoding = false;
export class PreviewExportError extends Error {
  constructor(readonly reason: "busy" | "size" | "canvas") { super(reason); }
}
const checkAbort = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException("Export cancelled", "AbortError"); };
export async function exportPreviewGif({ chart, duration, range, mirror, signal, onProgress }: {
  chart: Chart; duration: number; range: PreviewRange; mirror: MirrorMode; signal: AbortSignal;
  onProgress(value: number): void;
}): Promise<Blob> {
  const count = gifFrameCount(range, duration);
  checkAbort(signal);
  if (encoding) throw new PreviewExportError("busy");
  encoding = true;
  let canvas: HTMLCanvasElement | undefined;
  let renderer: MainRenderer | undefined;
  try {
    canvas = document.createElement("canvas");
    renderer = new MainRenderer(canvas, { sensorImagePath: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=", showStatistics: false });
    renderer.resizeToSize(GIF_SIZE, 1); renderer.setJudgmentLineDesign("simple"); renderer.setMirrorMode(mirror);
    const context = canvas.getContext("2d");
    if (!context) throw new PreviewExportError("canvas");
    const timeline = TimingTimeline.fromChart(chart);
    const gif = GIFEncoder({ initialCapacity: 1024 * 1024 });
    onProgress(0);
    for (let i = 0; i < count; i++) {
      checkAbort(signal);
      const seconds = range.start + i / GIF_FPS;
      renderer.renderFrame(chart, timeline.beatFromMs(seconds * 1000), 4);
      const pixels = context.getImageData(0, 0, GIF_SIZE, GIF_SIZE);
      const palette = quantize(pixels.data, 256);
      gif.writeFrame(applyPalette(pixels.data, palette), GIF_SIZE, GIF_SIZE, {
        palette, delay: 1000 / GIF_FPS, repeat: 0,
      });
      // Public encoder API returns a copy. Check in small batches rather than retain every frame.
      if ((i + 1) % 10 === 0 && gif.bytes().byteLength > MAX_GIF_BYTES) throw new PreviewExportError("size");
      onProgress((i + 1) / count);
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    checkAbort(signal); gif.finish();
    const bytes = new Uint8Array(gif.bytes());
    if (bytes.byteLength > MAX_GIF_BYTES) throw new PreviewExportError("size");
    return new Blob([bytes], { type: "image/gif" });
  } finally {
    renderer?.setIsPlaying(false); renderer?.setBackgroundImage(null);
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    encoding = false;
  }
}
