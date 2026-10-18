import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { m } from "@/paraglide/messages.js";
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
    createGain = () => ({ gain: { value: 1 }, connect() {}, disconnect() {} });
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
    createGain = () => ({ gain: { value: 1 }, connect() {}, disconnect() {} });
    createBufferSource = () => ({ buffer: null, playbackRate: { value: 1 }, connect() {}, start, stop() {}, disconnect() {} });
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
  fireEvent.change(screen.getByRole("slider", { name: m.chart_seek() }), { target: { value: "3" } });
  await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
  expect(start).toHaveBeenNthCalledWith(2, 0, 1 + first);
});

test("public preview uses public-only asset URLs and a 401 never redirects or tries private assets", async () => {
  fixture();
  const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => Response.json({ error: { code: "UNAUTHORIZED", message: "Denied" } }, { status: 401 }));
  vi.stubGlobal("fetch", fetcher);
  const { publicChartAssetUrl } = await import("@/client/queries/public-charts");
  render(<PrivateChartPreview id="public" versionId="selected" summary={summary} assetUrl={publicChartAssetUrl} />);
  fireEvent.click(screen.getByRole("button", { name: "加载预览" }));
  await screen.findByRole("alert");
  expect(fetcher.mock.calls).toHaveLength(1);
  expect(fetcher.mock.calls[0]?.[0]).toBe("/api/v1/charts/public/versions/selected/assets/maidata");
  expect(assign).not.toHaveBeenCalled();
  assign.mockRestore();
});

test("public cover/audio/maidata all stay on the explicit public version and stable resolver does not restart playback", async () => {
  fixture();
  vi.stubGlobal("Image", class { src = ""; decode = async () => {}; });
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(new Uint8Array([1, 2, 3])));
  vi.stubGlobal("fetch", fetcher);
  const { publicChartAssetUrl } = await import("@/client/queries/public-charts");
  const publicSummary = { ...summary, hasCover: true };
  const { rerender } = render(<PrivateChartPreview id="public" versionId="selected" summary={publicSummary} assetUrl={publicChartAssetUrl} />);
  fireEvent.click(screen.getByRole("button", { name: "加载预览" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "播放" }) as HTMLButtonElement).disabled).toBe(false));
  expect(fetcher.mock.calls.map(row => row[0])).toEqual([
    "/api/v1/charts/public/versions/selected/assets/maidata",
    "/api/v1/charts/public/versions/selected/assets/cover",
    "/api/v1/charts/public/versions/selected/assets/audio",
  ]);
  rerender(<PrivateChartPreview id="public" versionId="selected" summary={publicSummary} assetUrl={publicChartAssetUrl} />);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

test("controls changed during maidata loading become the actual playback settings", async () => {
  fixture();
  const start = vi.fn(), playbackRate = { value: 1 }, gain = { value: 1 };
  vi.stubGlobal("AudioContext", class {
    currentTime = 0; destination = {};
    resume = async () => {};
    decodeAudioData = async () => ({ duration: 10 });
    createGain = () => ({ gain, connect() {}, disconnect() {} });
    createBufferSource = () => ({ buffer: null, playbackRate, connect() {}, start, stop() {}, disconnect() {} });
    close = fakes.close;
  });
  let release!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/maidata")
    ? new Promise<Response>(resolve => { release = resolve; }) : new Response(new Uint8Array([1,2,3]))));
  render(<PrivateChartPreview id="chart" versionId="version" summary={summary} />);
  fireEvent.click(screen.getByRole("button", { name: m.chart_preview_load() }));
  await waitFor(() => expect(release).toBeTypeOf("function"));
  fireEvent.change(screen.getByRole("combobox", { name: m.chart_preview_rate() }), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: m.chart_preview_mute() }));
  release(new Response("&inote_4=(120){4}1,2,3,E"));
  await waitFor(() => expect((screen.getByRole("button", { name: m.chart_play() }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: m.chart_play() }));
  await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  expect(playbackRate.value).toBe(2);
  expect(gain.value).toBe(0);
  expect(start).toHaveBeenCalledWith(1, 0);
});

test("preview shortcuts are scoped to its focused surface and do not override inputs", async () => {
  fixture();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("&inote_4=(120){4}1,2,3,E")));
  render(<><input aria-label="Outside preview" /><PrivateChartPreview id="chart" versionId="version" summary={{ ...summary, audio: null }} /></>);
  fireEvent.click(screen.getByRole("button", { name: m.chart_preview_load() }));
  await waitFor(() => expect((screen.getByRole("button", { name: m.chart_play() }) as HTMLButtonElement).disabled).toBe(false));
  const region = screen.getByRole("region", { name: m.chart_preview() });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Outside preview" }), { key: " " });
  expect(screen.queryByRole("button", { name: m.chart_pause() })).toBeNull();
  fireEvent.keyDown(region, { key: " " });
  await screen.findByRole("button", { name: m.chart_pause() });
  fireEvent.keyDown(screen.getByRole("slider", { name: m.chart_seek() }), { key: " " });
  expect(screen.getByRole("button", { name: m.chart_pause() })).toBeTruthy();
  fireEvent.keyDown(region, { key: "ArrowRight" });
  expect((screen.getByRole("slider", { name: m.chart_seek() }) as HTMLInputElement).value).toBe("5");
  fireEvent.keyDown(region, { key: "Home" });
  expect((screen.getByRole("slider", { name: m.chart_seek() }) as HTMLInputElement).value).toBe("0");
});
