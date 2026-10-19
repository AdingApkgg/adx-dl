import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { m } from "@/paraglide/messages.js";
import { PrivateChartPreview } from "@/client/components/private-chart-preview";
import type { ChartImportSummary } from "@/shared/charts";
import { parseSimaiChart as realParseSimaiChart } from "@lxns-network/maimai-chart-engine/parser";
const fakes = vi.hoisted(() => ({ renderer: vi.fn(), close: vi.fn(async () => {}), cancelled: vi.fn(), parse: vi.fn(), mirror: vi.fn() }));
vi.mock("@lxns-network/maimai-chart-engine", () => ({
  parseSimaiChart: (text: string) => fakes.parse(text) ?? ({ bpm: 120, firstMs: 0, notes: [] }),
  TimingTimeline: { fromChart: () => ({ beatFromMs: (ms: number) => ms / 500 }) },
  MainRenderer: class {
    constructor() { fakes.renderer(); }
    setJudgmentLineDesign() {} setMirrorMode(mode: string) { fakes.mirror(mode); } renderFrame() {} resize() {} setBackgroundImage() {} setIsPlaying() {}
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


test("engine mirror changes repaint a paused preview and a new chart resets the choice", async () => {
  fixture();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("&inote_4=(120){4}1,2,3,E")));
  const { rerender } = render(<PrivateChartPreview id="one" versionId="version" summary={{ ...summary, audio: null }} />);
  fireEvent.click(screen.getByRole("button", { name: m.chart_preview_load() }));
  await waitFor(() => expect((screen.getByRole("button", { name: m.chart_play() }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.change(screen.getByRole("combobox", { name: m.chart_preview_mirror() }), { target: { value: "horizontal" } });
  expect(fakes.mirror).toHaveBeenLastCalledWith("horizontal");
  expect(screen.queryByRole("button", { name: m.chart_pause() })).toBeNull();
  rerender(<PrivateChartPreview id="two" versionId="version" summary={{ ...summary, audio: null }} />);
  expect(screen.queryByRole("slider", { name: m.chart_seek() })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: m.chart_preview_load() }));
  await waitFor(() => expect(fakes.mirror).toHaveBeenLastCalledWith("none"));
});

test("a paused A/B edit stays paused; seeking outside disables looping and preserves the selection", async () => {
  fixture();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("&inote_4=(120){4}1,2,3,E")));
  render(<PrivateChartPreview id="chart" versionId="version" summary={{ ...summary, audio: null }} />);
  fireEvent.click(screen.getByRole("button", { name: m.chart_preview_load() }));
  await waitFor(() => expect((screen.getByRole("button", { name: m.chart_play() }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.change(screen.getByRole("slider", { name: m.chart_seek() }), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: m.chart_preview_set_a() }));
  fireEvent.click(screen.getByRole("button", { name: m.chart_preview_loop() }));
  expect(screen.getByRole("button", { name: m.chart_preview_loop() }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.queryByRole("button", { name: m.chart_pause() })).toBeNull();
  fireEvent.change(screen.getByRole("slider", { name: m.chart_seek() }), { target: { value: "0" } });
  expect(screen.getByRole("button", { name: m.chart_preview_loop() }).getAttribute("aria-pressed")).toBe("false");
  expect(screen.getByRole("slider", { name: /区间起点 A/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: m.chart_close() }));
  fireEvent.click(screen.getByRole("button", { name: m.chart_preview_load() }));
  expect(screen.queryByRole("slider", { name: /区间起点 A/ })).toBeNull();
});

test("native audio looping continues across visual wraps at the selected speed without restarting sources", async () => {
  fixture();
  let now = 0, nextFrame: FrameRequestCallback | undefined;
  const starts: unknown[][] = [], sources: { loop: boolean; loopStart: number; loopEnd: number }[] = [];
  vi.stubGlobal("requestAnimationFrame", vi.fn(callback => { nextFrame = callback; return 1; }));
  vi.stubGlobal("AudioContext", class {
    get currentTime() { return now; } destination = {};
    resume = async () => {};
    decodeAudioData = async () => ({ duration: 10 });
    createGain = () => ({ gain: { value: 1 }, connect() {}, disconnect() {} });
    createBufferSource = () => {
      const source = { buffer: null, playbackRate: { value: 1 }, loop: false, loopStart: 0, loopEnd: 0, connect() {},
        start(...args: unknown[]) { starts.push(args); }, stop() {}, disconnect() {} };
      sources.push(source); return source;
    };
    close = fakes.close;
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("&inote_4=(120){4}1,2,3,E")));
  render(<PrivateChartPreview id="chart" versionId="version" summary={summary} />);
  fireEvent.click(screen.getByRole("button", { name: m.chart_preview_load() }));
  await waitFor(() => expect((screen.getByRole("button", { name: m.chart_play() }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.change(screen.getByRole("slider", { name: m.chart_seek() }), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: m.chart_preview_set_a() }));
  fireEvent.change(screen.getByRole("slider", { name: /区间终点 B/ }), { target: { value: "4" } });
  fireEvent.change(screen.getByRole("combobox", { name: m.chart_preview_rate() }), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: m.chart_preview_loop() }));
  fireEvent.click(screen.getByRole("button", { name: m.chart_play() }));
  await waitFor(() => expect(starts).toHaveLength(1));
  expect(sources[0]).toMatchObject({ loop: true, loopStart: 0, loopEnd: 2 });
  now = 1.25;
  const { act } = await import("@testing-library/react");
  act(() => nextFrame?.(1250));
  // The audio device repeats buffer 0..2; chart time 4.5 wraps to 2.5 with no new source.
  expect(starts).toHaveLength(1);
  expect((screen.getByRole("slider", { name: m.chart_seek() }) as HTMLInputElement).value).toBe("2.5");
});

test("export rechecks the public version and denied access never fetches private resources", async () => {
  fixture();
  let reads = 0;
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ++reads === 1 ? new Response("&inote_4=(120){4}1,2,3,E")
    : Response.json({ error: { code: "NOT_FOUND", message: "Withdrawn" } }, { status: 404 }));
  vi.stubGlobal("fetch", fetcher);
  const { publicChartAssetUrl } = await import("@/client/queries/public-charts");
  render(<PrivateChartPreview id="1" versionId="selected" summary={{ ...summary, audio: null }} assetUrl={publicChartAssetUrl} />);
  fireEvent.click(screen.getByRole("button", { name: m.chart_preview_load() }));
  await waitFor(() => expect((screen.getByRole("button", { name: m.chart_play() }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: m.chart_preview_set_a() }));
  fireEvent.click(screen.getByRole("button", { name: m.chart_preview_export() }));
  await screen.findByText(m.public_chart_unavailable());
  expect(fetcher.mock.calls).toHaveLength(2);
  for (const call of fetcher.mock.calls) expect(call[0]).toBe("/api/v1/charts/1/versions/selected/assets/maidata");
  expect(screen.queryByRole("link", { name: m.chart_preview_export_download() })).toBeNull();
});


test("cancelling export aborts version reauthorization and retains the A/B selection for retry", async () => {
  fixture();
  let reads = 0, exportSignal: AbortSignal | undefined;
  vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (++reads === 1) return new Response("&inote_4=(120){4}1,2,3,E");
    exportSignal = init?.signal as AbortSignal;
    return new Promise<Response>((_resolve, reject) => {
      exportSignal!.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
    });
  }));
  render(<PrivateChartPreview id="chart" versionId="version" summary={{ ...summary, audio: null }} />);
  fireEvent.click(screen.getByRole("button", { name: m.chart_preview_load() }));
  await waitFor(() => expect((screen.getByRole("button", { name: m.chart_play() }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: m.chart_preview_set_a() }));
  fireEvent.click(screen.getByRole("button", { name: m.chart_preview_export() }));
  await waitFor(() => expect(exportSignal).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: m.chart_preview_export_cancel() }));
  await screen.findByText(m.chart_preview_export_cancelled());
  expect(exportSignal!.aborted).toBe(true);
  expect(screen.getByRole("slider", { name: /区间起点 A/ })).toBeTruthy();
  expect((screen.getByRole("button", { name: m.chart_preview_export() }) as HTMLButtonElement).disabled).toBe(false);
});


test("Pause cancels a first Play that is still decoding and a late decode never starts audio", async () => {
  fixture();
  let finishDecode!: (buffer: { duration: number }) => void;
  const start = vi.fn();
  vi.stubGlobal("AudioContext", class {
    currentTime = 0; destination = {}; resume = async () => {};
    decodeAudioData = () => new Promise<{ duration: number }>(resolve => { finishDecode = resolve; });
    createGain = () => ({ gain: { value: 1 }, connect() {}, disconnect() {} });
    createBufferSource = () => ({ buffer: null, playbackRate: { value: 1 }, connect() {}, start, stop() {}, disconnect() {} });
    close = fakes.close;
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("&inote_4=(120){4}1,2,3,E")));
  render(<PrivateChartPreview id="chart" versionId="version" summary={summary} />);
  fireEvent.click(screen.getByRole("button", { name: m.chart_preview_load() }));
  await waitFor(() => expect((screen.getByRole("button", { name: m.chart_play() }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: m.chart_play() }));
  await waitFor(() => expect(finishDecode).toBeTypeOf("function"));
  fireEvent.click(screen.getByRole("button", { name: m.chart_pause() }));
  const { act } = await import("@testing-library/react");
  await act(async () => { finishDecode({ duration: 10 }); await Promise.resolve(); });
  expect(start).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: m.chart_play() })).toBeTruthy();
});

test("hiding a looping preview pauses it and returning does not silently resume", async () => {
  fixture();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("&inote_4=(120){4}1,2,3,E")));
  render(<PrivateChartPreview id="chart" versionId="version" summary={{ ...summary, audio: null }} />);
  fireEvent.click(screen.getByRole("button", { name: m.chart_preview_load() }));
  await waitFor(() => expect((screen.getByRole("button", { name: m.chart_play() }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: m.chart_preview_loop() }));
  fireEvent.click(screen.getByRole("button", { name: m.chart_play() }));
  await screen.findByRole("button", { name: m.chart_pause() });
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  fireEvent(document, new Event("visibilitychange"));
  expect(screen.getByRole("button", { name: m.chart_play() })).toBeTruthy();
  hidden.mockReturnValue(false); fireEvent(document, new Event("visibilitychange"));
  expect(screen.getByRole("button", { name: m.chart_play() })).toBeTruthy();
  hidden.mockRestore();
});

test('shared difficulty and initial position remain lazy, paused and clamped to current duration',async()=>{
 fixture();const fetcher=vi.fn(async()=>new Response('&inote_4=(120){4}1,2,3,E'));vi.stubGlobal('fetch',fetcher);
 render(<PrivateChartPreview id="chart" versionId="version" summary={summary} initialDifficulty={4} initialPosition={100}/>);
 expect(fetcher).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:m.chart_preview_load()}));
 await waitFor(()=>expect((screen.getByRole('button',{name:m.chart_preview_play()}) as HTMLButtonElement).disabled).toBe(false));
 expect(Number((screen.getByRole('slider',{name:m.chart_preview_seek()}) as HTMLInputElement).value)).toBe(5);
 expect(screen.queryByRole('button',{name:m.chart_preview_pause()})).toBeNull();
});
