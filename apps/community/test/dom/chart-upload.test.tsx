import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
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
    if (path === "/api/v1/files/f") return Response.json({ id: "f", purpose: "chart-source", name: "chart.zip", size: 3, state: "ready", chart: summary, createdAt: "" });
    throw new Error(`Unexpected ${init?.method} ${path}`);
  });
  vi.stubGlobal("fetch", fetcher);
  const save = vi.fn(async () => {});
  render(<MemoryRouter><ChartUpload userId="alice" onSave={save} /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText("选择 ZIP"), { target: { files: [new File(["zip"], "chart.zip", { type: "application/zip" })] } });
  await waitFor(() => expect(screen.getByRole("button", { name: "保存私有草稿" })).toBeTruthy());
  expect(save).not.toHaveBeenCalled();
  expect(fetcher.mock.calls.every(([input]) => !String(input).includes("/me/charts"))).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "保存私有草稿" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByRole("button", { name: "保存私有草稿" })).toBeNull());
  expect(JSON.parse(localStorage.getItem("astrodx-uploads:alice") ?? "[]")).toEqual([]);
});
