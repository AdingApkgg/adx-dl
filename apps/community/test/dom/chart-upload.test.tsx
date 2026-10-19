import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { zipSync, unzipSync } from "fflate";
import { ChartUpload } from "@/client/components/chart-upload";
import { createApiClient } from "@/shared/api-client";
const api = createApiClient("https://community.test");
vi.mock("@/client/lib/browser", () => ({ getBrowserApi: () => api }));
class HashWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror = null;
  postMessage() { queueMicrotask(() => this.onmessage?.({ data: { hash: "a".repeat(64) } })); }
  terminate() {}
}
afterEach(() => vi.unstubAllGlobals());
test("validated chart stays unsaved until explicit Save, then recovery is cleared", async () => {
  vi.stubGlobal("Worker", HashWorker);
  const summary = { title: "Test", artist: "", maidataMd5Base64: "md5", difficulties: [{ difficulty: 4, level: "12", noteCount: 3, durationMs: 5000, previewSupported: true }], warnings: [], audio: null, hasCover: false };
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/v1/uploads") return Response.json({ id: "u", state: "receiving", expiresAt: new Date(Date.now() + 60000).toISOString(), partSize: 4194304, partCount: 1, receivedParts: [] });
    if (path.endsWith("/parts/0")) return new Response(null, { status: 204 });
    if (path.endsWith("/complete")) return Response.json({ id: "u", state: "ready", fileId: "f", receivedParts: [] });
    if (path === "/api/v1/uploads/u") return Response.json({ id: "u", state: "receiving", partSize: 4194304, partCount: 1, receivedParts: [{ index: 0, size: 3, sha256: "a".repeat(64) }] });
    if(path === "/api/v1/me/charts/bindings/f")return Response.json({state:"unbound"});
    if(path === "/api/v1/me/charts/workbench")return Response.json({counts:{total:0},targets:[],usage:{usedBytes:3,reservedBytes:0,quotaBytes:268435456}});
    if(path === "/api/v1/me/charts")return Response.json({id:"chart",versions:[{id:"version",sourceFileId:"f"}]},{status:201});
    if (path === "/api/v1/files/f") return Response.json({ id: "f", purpose: "chart-source", name: "chart.zip", size: 3, state: "ready", chart: summary, createdAt: "" });
    throw new Error(`Unexpected ${init?.method} ${path}`);
  });
  vi.stubGlobal("fetch", fetcher);
  const save = vi.fn(async () => {});
  render(<MemoryRouter><ChartUpload userId="alice" onSaved={save} /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText("选择 ADX / ZIP"), { target: { files: [new File(["zip"], "chart.zip", { type: "application/zip" })] } });
  await waitFor(() => expect(screen.getByRole("button", { name: "保存私有草稿" })).toBeTruthy());
  expect(save).not.toHaveBeenCalled();
  expect(fetcher.mock.calls.every(([input]) => !String(input).includes("/me/charts"))).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "保存私有草稿" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByRole("button", { name: "保存私有草稿" })).toBeNull());
  expect(JSON.parse(localStorage.getItem("astrodx-uploads:alice") ?? "[]")).toEqual([]);
});


test("ADX archives can be selected without renaming or changing their upload identity", async () => {
  vi.stubGlobal("Worker", HashWorker);
  const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    if (new URL(String(input)).pathname === "/api/v1/uploads") return new Response(JSON.stringify({ error: { code: "STORAGE_MAINTENANCE", message: "offline" } }), { status: 503, headers: { "content-type": "application/json" } });
    throw new Error("unexpected request");
  });
  vi.stubGlobal("fetch", fetcher);
  render(<MemoryRouter><ChartUpload userId="alice" onSaved={async () => {}} /></MemoryRouter>);
  const picker = screen.getByLabelText(/选择.*ZIP/);
  expect(picker.getAttribute("accept")).toContain(".adx");
  fireEvent.change(picker, { target: { files: [new File(["zip"], "single-chart.adx", { type: "application/octet-stream" })] } });
  await waitFor(() => expect(fetcher).toHaveBeenCalled());
  expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toMatchObject({ purpose: "chart-source", name: "single-chart.adx", size: 3 });
});

test("separate score/audio/cover/video wait for explicit assembly then upload one byte-preserving archive", async () => {
  class PackingWorker extends HashWorker {
    override postMessage(data?: unknown) {
      if (!Array.isArray(data)) return super.postMessage();
      void Promise.all(data.map(async ({ file, path }: { file: File; path: string }) => [path, new Uint8Array(await file.arrayBuffer())] as const))
        .then((entries) => { const zip = zipSync(Object.fromEntries(entries), { level: 0 }); this.onmessage?.({ data: { zip: zip.buffer } }); });
    }
  }
  vi.stubGlobal("Worker", PackingWorker);
  let uploaded: Uint8Array | undefined;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/v1/uploads") return Response.json({ id: "loose", state: "receiving", expiresAt: new Date(Date.now() + 60000).toISOString(), partSize: 1048576, partCount: 1, receivedParts: [] });
    if (path.endsWith("/parts/0")) { uploaded = new Uint8Array(await (init!.body as Blob).arrayBuffer()); return new Response(null, { status: 204 }); }
    if (path === "/api/v1/uploads/loose") return Response.json({ id: "loose", state: "receiving", partSize: 1048576, partCount: 1, receivedParts: [{ index: 0, size: uploaded!.length, sha256: "a".repeat(64) }] });
    if (path.endsWith("/complete")) return Response.json({ id: "loose", state: "ready", fileId: "loose-file", receivedParts: [] });
    if (path === "/api/v1/files/loose-file") return Response.json({ id: "loose-file", purpose: "chart-source", name: "chart.zip", size: uploaded!.length, state: "ready", chart: { title: "Loose", artist: "", maidataMd5Base64: "md5", difficulties: [{ difficulty: 4, level: null, noteCount: 1, durationMs: 1000, previewSupported: true }], warnings: [], audio: null, hasCover: false }, createdAt: "" });
    throw new Error(`Unexpected ${init?.method} ${path}`);
  });
  vi.stubGlobal("fetch", fetcher);
  render(<MemoryRouter><ChartUpload userId="alice" onSaved={async () => {}} /></MemoryRouter>);
  const submit = screen.getByRole("button", { name: "组装并上传" });
  expect(submit.hasAttribute("disabled")).toBe(true);
  fireEvent.change(screen.getByLabelText("谱面文件（必选）"), { target: { files: [new File(["&inote_4=(120)1,E"], "my-score.txt")] } });
  fireEvent.change(screen.getByLabelText("音乐（可选）"), { target: { files: [new File(["audio-bytes"], "music.ogg")] } });
  fireEvent.change(screen.getByLabelText("曲绘（可选）"), { target: { files: [new File(["cover-bytes"], "picture.png")] } });
  fireEvent.change(screen.getByLabelText(/背景视频/), { target: { files: [new File(["video-bytes"], "movie.mp4")] } });
  fireEvent.click(screen.getByRole("button", { name: /移除.*背景视频/ }));
  expect(screen.queryByText("movie.mp4")).toBeNull();
  for (const name of ["my-score.txt", "music.ogg", "picture.png"]) expect(screen.getByText(name)).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(/背景视频/), { target: { files: [new File(["video-bytes"], "movie.mp4")] } });
  await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(submit);
  await waitFor(() => expect(screen.getByRole("button", { name: "保存私有草稿" })).toBeTruthy());
  const contents = unzipSync(uploaded!);
  expect(Object.keys(contents)).toEqual(["bg.png", "maidata.txt", "pv.mp4", "track.ogg"]);
  expect(new TextDecoder().decode(contents["maidata.txt"])).toBe("&inote_4=(120)1,E");
  expect(new TextDecoder().decode(contents["track.ogg"])).toBe("audio-bytes");
  expect(new TextDecoder().decode(contents["bg.png"])).toBe("cover-bytes");
  expect(new TextDecoder().decode(contents["pv.mp4"])).toBe("video-bytes");
});
