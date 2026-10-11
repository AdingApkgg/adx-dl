import { QueryClientProvider, dehydrate } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentType } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import ChartDetail from "@/client/routes/chart-detail";
import { chartQuery } from "@/client/queries/charts";
import { createApiClient } from "@/shared/api-client";
import type { ChartDto } from "@/shared/charts";
import { makeQueryClient } from "@/shared/query-client";
const api = createApiClient("https://community.test");
vi.mock("@/client/lib/browser", () => ({ getBrowserApi: () => api, getRenderApi: () => api }));
const Page = ChartDetail as unknown as ComponentType<{ params: { id: string }; loaderData: { dehydratedState: ReturnType<typeof dehydrate> } }>;
const summary = { title: "Original", artist: "Artist", maidataMd5Base64: "md5", difficulties: [{ difficulty: 4 as const, level: "12", noteCount: 3, durationMs: 5000, previewSupported: true }], warnings: [], audio: null, hasCover: false };
const initial: ChartDto = { id: "chart", title: "Original", artist: "Artist", revision: 2, currentVersionId: "v2", createdAt: "2026-10-10T00:00:00.000Z", updatedAt: "2026-10-11T00:00:00.000Z",
  versions: [2, 1].map((ordinal) => ({ id: `v${ordinal}`, ordinal, sourceFileId: `f${ordinal}`, sourceSize: 3, summary, createdAt: "2026-10-11T00:00:00.000Z" })) };
class HashWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null; onerror = null;
  postMessage() { queueMicrotask(() => this.onmessage?.({ data: { hash: "a".repeat(64) } })); }
  terminate() {}
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function setup(handler: (path: string, method: string, body: Record<string, unknown>) => Promise<Response> | Response) {
  const requests: { path: string; method: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("Worker", HashWorker);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = { path: new URL(String(input)).pathname, method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : {} };
    requests.push(request); return handler(request.path, request.method, request.body);
  }));
  const client = makeQueryClient(); client.setQueryData(["me"], { id: "alice", status: "active" }); client.setQueryData(chartQuery(api, "chart").queryKey, initial);
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/me/charts/chart"]}><Page params={{ id: "chart" }} loaderData={{ dehydratedState: dehydrate(client) }} /></MemoryRouter></QueryClientProvider>);
  return requests;
}
test("metadata conflict uses the edit revision, reads latest state and keeps the user's title", async () => {
  const latest = { ...initial, title: "External change", revision: 3 };
  const requests = setup((_path, method) => method === "PATCH" ? Response.json({ error: { code: "CHART_CHANGED", message: "Changed" } }, { status: 409 }) : Response.json(latest));
  fireEvent.change(screen.getByRole("textbox", { name: "标题" }), { target: { value: "My unsaved title" } });
  fireEvent.click(screen.getByRole("button", { name: "保存标题和曲师" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("草稿已发生变化"));
  expect((screen.getByRole("textbox", { name: "标题" }) as HTMLInputElement).value).toBe("My unsaved title");
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("External change");
  expect(requests.filter((row) => row.method === "PATCH")).toEqual([{ path: "/api/v1/me/charts/chart", method: "PATCH", body: { expectedRevision: 2, title: "My unsaved title", artist: "Artist" } }]);
  expect(requests.some((row) => row.method === "GET")).toBe(true);
});
test("a lost successful metadata response reads current state instead of replaying PATCH", async () => {
  let actual = initial;
  const requests = setup((_path, method, body) => {
    if (method === "PATCH") { actual = { ...initial, title: String(body.title), artist: String(body.artist), revision: 3 }; throw new TypeError("Response lost"); }
    return Response.json(actual);
  });
  fireEvent.change(screen.getByRole("textbox", { name: "标题" }), { target: { value: "Saved remotely" } });
  fireEvent.click(screen.getByRole("button", { name: "保存标题和曲师" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "保存标题和曲师" }) as HTMLButtonElement).disabled).toBe(false));
  expect(requests.filter((row) => row.method === "PATCH")).toHaveLength(1);
  expect(requests.findIndex((row) => row.method === "GET")).toBeGreaterThan(requests.findIndex((row) => row.method === "PATCH"));
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Saved remotely");
  expect(screen.queryByRole("alert")).toBeNull();
});
test("rejected replacement leaves the current version untouched and never saves a new version", async () => {
  const requests = setup((path) => {
    if (path === "/api/v1/uploads") return Response.json({ id: "u", state: "receiving", expiresAt: new Date(Date.now() + 60000).toISOString(), partSize: 4194304, partCount: 1, receivedParts: [] });
    if (path.endsWith("/parts/0")) return new Response(null, { status: 204 });
    if (path.endsWith("/complete")) return Response.json({ id: "u", state: "rejected", errorCode: "CHART_PACKAGE_INVALID", receivedParts: [] });
    if (path === "/api/v1/uploads/u") return Response.json({ id: "u", state: "receiving", partSize: 4194304, partCount: 1, receivedParts: [{ index: 0, size: 3, sha256: "a".repeat(64) }] });
    throw new Error(`Unexpected ${path}`);
  });
  fireEvent.change(screen.getByLabelText("选择 ZIP"), { target: { files: [new File(["bad"], "bad.zip", { type: "application/zip" })] } });
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("未通过校验"));
  expect(within(screen.getByText(/^版本 2/).closest("li")!).getByText("当前版本")).toBeTruthy();
  expect(requests.some((row) => row.path === "/api/v1/me/charts/chart/versions")).toBe(false);
  expect(screen.queryByRole("button", { name: "保存私有草稿" })).toBeNull();
});
test("current version has no delete action and historical deletion requires confirmation with its revision", async () => {
  const requests = setup((path, method) => method === "DELETE" ? new Response(null, { status: 204 }) : Response.json({ ...initial, revision: 3, versions: [initial.versions[0]!] }));
  const current = screen.getByText(/^版本 2/).closest("li")!;
  expect(within(current).queryByRole("button", { name: "删除版本" })).toBeNull();
  fireEvent.click(within(screen.getByText(/^版本 1/).closest("li")!).getByRole("button", { name: "删除版本" }));
  expect(requests.filter((row) => row.method === "DELETE")).toHaveLength(0);
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "删除草稿" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(requests.filter((row) => row.method === "DELETE")).toEqual([{ path: "/api/v1/me/charts/chart/versions/v1", method: "DELETE", body: { expectedRevision: 2 } }]);
  expect(screen.queryByText(/^版本 1/)).toBeNull();
});

test("an expired editor session redirects to login after the failed save", async () => {
  const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
  setup(() => Response.json({ error: { code: "UNAUTHORIZED", message: "Sign in" } }, { status: 401 }));
  fireEvent.change(screen.getByRole("textbox", { name: "标题" }), { target: { value: "Unsaved" } });
  fireEvent.click(screen.getByRole("button", { name: "保存标题和曲师" }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith("/login?next=%2Fme%2Fcharts%2Fchart"));
});

test("editor permission failure keeps the input and displays denial without forcing another login", async () => {
  const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
  setup((_path, method) => method === "PATCH" ? Response.json({ error: { code: "FORBIDDEN", message: "Denied" } }, { status: 403 }) : Response.json(initial));
  fireEvent.change(screen.getByRole("textbox", { name: "标题" }), { target: { value: "Unsaved" } });
  fireEvent.click(screen.getByRole("button", { name: "保存标题和曲师" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("你没有访问这份私有谱面的权限。"));
  expect((screen.getByRole("textbox", { name: "标题" }) as HTMLInputElement).value).toBe("Unsaved");
  expect(assign).not.toHaveBeenCalled();
});
