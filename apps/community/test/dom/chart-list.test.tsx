import { QueryClientProvider, dehydrate } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import Charts from "@/client/routes/charts";
import { chartsQuery } from "@/client/queries/charts";
import { createApiClient } from "@/shared/api-client";
import type { ChartListItemDto, ChartsPageDto } from "@/shared/charts";
import { makeQueryClient } from "@/shared/query-client";
const api = createApiClient("https://community.test");
vi.mock("@/client/lib/browser", () => ({ getBrowserApi: () => api, getRenderApi: () => api }));
const Page = Charts as unknown as ComponentType<{ loaderData: { dehydratedState: ReturnType<typeof dehydrate> } }>;
const item = (id: string): ChartListItemDto => ({ id, title: id, artist: "", revision: 1, currentVersionId: `${id}-version`,
  updatedAt: "2026-10-11T00:00:00.000Z", summary: { title: id, artist: "", maidataMd5Base64: "md5", difficulties: [], warnings: [], audio: null, hasCover: false } });
const usage = { usedBytes: 32 * 1024 * 1024, reservedBytes: 4 * 1024 * 1024, quotaBytes: 256 * 1024 * 1024 };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function setup(data: ChartsPageDto) {
  const client = makeQueryClient(); client.setQueryData(chartsQuery(api).queryKey, data);
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/me/charts"]}><Page loaderData={{ dehydratedState: dehydrate(client) }} /></MemoryRouter></QueryClientProvider>);
}
test("an empty private chart list offers upload without fake items or pagination", () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  setup({ items: [], nextCursor: null, usage });
  expect(screen.getByText("还没有私有草稿。")).toBeTruthy();
  expect(screen.getByRole("link", { name: "上传谱面" }).getAttribute("href")).toBe("/me/charts/new");
  expect(screen.queryByRole("button", { name: "下一页" })).toBeNull();
  expect(screen.getByText("谱面配额已用 32.00 / 256 MiB（包含历史版本）。")).toBeTruthy();
  expect(screen.getByText("进行中的上传另占用同一配额的 4.00 MiB。")).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
});
test("private list passes the opaque cursor, next-page items replace old items, and previous restores its page", async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    expect(url.pathname).toBe("/api/v1/me/charts"); expect(url.searchParams.get("cursor")).toBe("opaque+/cursor=");
    return Response.json({ items: [item("Second")], nextCursor: null, usage });
  });
  vi.stubGlobal("fetch", fetcher);
  setup({ items: [item("First")], nextCursor: "opaque+/cursor=", usage });
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  await waitFor(() => expect(screen.getByRole("link", { name: "Second" })).toBeTruthy());
  expect(screen.queryByRole("link", { name: "First" })).toBeNull();
  expect(screen.getByRole("link", { name: "Second" }).getAttribute("href")).toBe("/me/charts/Second");
  fireEvent.click(screen.getByRole("button", { name: "上一页" }));
  await waitFor(() => expect(screen.getByRole("link", { name: "First" })).toBeTruthy());
  expect(fetcher).toHaveBeenCalledTimes(1);
});

test("an expired list session redirects to login with the private path", async () => {
  const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "UNAUTHORIZED", message: "Sign in" } }, { status: 401 })));
  setup({ items: [], nextCursor: "next", usage });
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith("/login?next=%2Fme%2Fcharts"));
});

for (const [status, code, message] of [[403, "FORBIDDEN", "你没有访问这份私有谱面的权限。"], [404, "NOT_FOUND", "找不到此私有谱面或上传文件，可能已被删除。"]] as const) {
  test(`list ${status} displays its error without turning a missing/forbidden resource into a login`, async () => {
    const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code, message: "Denied" } }, { status })));
    setup({ items: [], nextCursor: "next", usage });
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(message));
    expect(assign).not.toHaveBeenCalled();
  });
}
