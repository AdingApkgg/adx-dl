import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { PrivateChartPreview } from "@/client/components/private-chart-preview";
import type { ChartImportSummary } from "@/shared/charts";
import { parseSimaiChart as realParseSimaiChart } from "@lxns-network/maimai-chart-engine/parser";
const fakes = vi.hoisted(() => ({ renderer: vi.fn(), close: vi.fn(async () => {}), cancelled: vi.fn(), parse: vi.fn() }));
vi.mock("@lxns-network/maimai-chart-engine", () => ({
  parseSimaiChart: (text: string) => fakes.parse(text) ?? ({ bpm: 120, firstMs: 0 }),
  TimingTimeline: { fromChart: () => ({ beatFromMs: (ms: number) => ms / 500 }) },
  MainRenderer: class {
    constructor() { fakes.renderer(); }
    setJudgmentLineDesign() {} renderFrame() {} resize() {} setBackgroundImage() {} setIsPlaying() {}
  },
}));
const summary: ChartImportSummary = { title: "Test", artist: "", maidataMd5Base64: "md5",
  difficulties: [{ difficulty: 4, level: "12", noteCount: 3, durationMs: 5000, previewSupported: true }], warnings: [], audio: { mime: "audio/mpeg", size: 3 }, hasCover: false };
function fixture() {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", fakes.cancelled);
  vi.stubGlobal("AudioContext", class {
    currentTime = 0;
    resume = async () => {};
    decodeAudioData = async () => { throw new Error("Unsupported audio"); };
    close = fakes.close;
  });
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); fakes.parse.mockReset(); });
test("unsupported difficulties cannot load preview resources", () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  render(<PrivateChartPreview id="chart" versionId="version" summary={{ ...summary, difficulties: [{ ...summary.difficulties[0]!, previewSupported: false }] }} />);
  expect((screen.getByRole("button", { name: "加载预览" }) as HTMLButtonElement).disabled).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();
});
test("preview loads only after request, decode failure stays silent and close releases playback resources", async () => {
  fixture();
  const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
  vi.stubGlobal("fetch", fetcher);
  render(<PrivateChartPreview id="chart" versionId="version" summary={summary} />);
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "加载预览" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "播放" }) as HTMLButtonElement).disabled).toBe(false));
  expect(fetcher.mock.calls).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "播放" }));
  await waitFor(() => expect(screen.getByText("当前为静音预览，仍可查看时间轴。")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));
  await waitFor(() => expect(fakes.close).toHaveBeenCalledTimes(1));
  expect(fakes.cancelled).toHaveBeenCalled();
  expect(screen.queryByRole("slider")).toBeNull();
});
test("closing a pending private asset aborts its request and suppresses late renderer setup", async () => {
  fixture();
  let release!: (response: Response) => void;
  let signal: AbortSignal | undefined;
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
    signal = init?.signal as AbortSignal;
    return new Promise<Response>((resolve) => { release = resolve; });
  }));
  render(<PrivateChartPreview id="chart" versionId="version" summary={summary} />);
  fireEvent.click(screen.getByRole("button", { name: "加载预览" }));
  await waitFor(() => expect(release).toBeTypeOf("function"));
  fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));
  expect(signal?.aborted).toBe(true);
  release(new Response("&inote_4=(120){4}1,2,3,E"));
  await Promise.resolve();
  expect(fakes.renderer).not.toHaveBeenCalled();
});

test("temporary audio loading failure still permits silent timeline preview", async () => {
  fixture();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/audio")
    ? Response.json({ error: { code: "STORAGE_UNAVAILABLE", message: "Unavailable" } }, { status: 503 })
    : new Response("&inote_4=(120){4}1,2,3,E")));
  render(<PrivateChartPreview id="chart" versionId="version" summary={summary} />);
  fireEvent.click(screen.getByRole("button", { name: "加载预览" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "播放" }) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.getByText("当前为静音预览，仍可查看时间轴。")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

test("a withdrawn private audio asset stops preview instead of silently bypassing owner checks", async () => {
  fixture();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/audio")
    ? Response.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 })
    : new Response("&inote_4=(120){4}1,2,3,E")));
  render(<PrivateChartPreview id="chart" versionId="version" summary={summary} />);
  fireEvent.click(screen.getByRole("button", { name: "加载预览" }));
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  expect((screen.getByRole("button", { name: "播放" }) as HTMLButtonElement).disabled).toBe(true);
  expect(fakes.cancelled).toHaveBeenCalled();
});

test.each([0, 0.5])("AudioContext start accounts for the engine lead-in, seek and first=%s with legacy chart input", async (first) => {
  fixture();
  const start = vi.fn();
  vi.stubGlobal("AudioContext", class {
    currentTime = 0; destination = {};
    resume = async () => {};
    decodeAudioData = async () => ({ duration: 10 });
    createBufferSource = () => ({ buffer: null, connect() {}, start, stop() {}, disconnect() {} });
    close = fakes.close;
  });
  // Use the real pure parser for this case so its four-beat lead-in is part of the integration.
  fakes.parse.mockImplementationOnce((text: string) => realParseSimaiChart(text, 4));
  const raw = first ? `&first=${first}\n(120){4}1,2,E` : "(120){4}1,2,E";
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/maidata")
    ? new Response(raw) : new Response(new Uint8Array([1, 2, 3]))));
  render(<PrivateChartPreview id="chart" versionId="version" summary={summary} />);
  fireEvent.click(screen.getByRole("button", { name: "加载预览" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "播放" }) as HTMLButtonElement).disabled).toBe(false));
  expect(fakes.parse).toHaveBeenCalledWith(expect.stringContaining("&inote_4="));
  fireEvent.click(screen.getByRole("button", { name: "播放" }));
  await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  expect(start).toHaveBeenNthCalledWith(1, 2 - first, 0);
  fireEvent.change(screen.getByRole("slider"), { target: { value: "3" } });
  await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
  expect(start).toHaveBeenNthCalledWith(2, 0, 1 + first);
});
