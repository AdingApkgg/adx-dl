import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { MemoryRouter, RouterContextProvider } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import PublicCharts, { loader as catalogLoader, headers as catalogHeaders, meta as catalogMeta } from "@/client/routes/public-charts";
import PublicChartDetail, { loader as detailLoader, meta as detailMeta } from "@/client/routes/public-chart-detail";
import { createApiClient } from "@/shared/api-client";
import type { PublicChartDto, PublicChartsPageDto } from "@/shared/charts";
import { apiContext } from "@/shared/router-context";
const chart: PublicChartDto = {
  id: "public", publicId: "42", versionId: "selected", ordinal: 2, title: "Published title", artist: "Snapshot artist", sourceSize: 1024,
  publishedAt: "2026-10-10T00:00:00.000Z", updatedAt: "2026-10-11T00:00:00.000Z", author: { id: "alice", name: "Alice", image: null },
  summary: { title: "Private title must not become metadata", artist: "Private artist", maidataMd5Base64: "hash", difficulties: [{ difficulty: 4, level: "12+", noteCount: 3, durationMs: 5000, previewSupported: true }, { difficulty: 5, level: null, noteCount: null, durationMs: null, previewSupported: false }], warnings: [], audio: null, hasCover: false },
};
const Catalog = PublicCharts as unknown as ComponentType<{ loaderData: PublicChartsPageDto }>;
const Detail = PublicChartDetail as unknown as ComponentType<{ loaderData: PublicChartDto }>;
afterEach(() => vi.unstubAllGlobals());
test("catalog links to public details, names authors and anonymous content, shows difficulties, fallback cover and encoded cursor", () => {
  render(<MemoryRouter><Catalog loaderData={{ items: [chart, { ...chart, id: "anon", title: "Anonymous chart", author: null }], nextCursor: "next/+=" }} /></MemoryRouter>);
  const link = screen.getByRole("link", { name: /Published title/ });
  expect(link.getAttribute("href")).toBe("/charts/42");
  expect(link.textContent).toContain("Alice");
  expect(link.textContent).toContain("12+");
  expect(link.textContent).toContain("暂不支持预览");
  expect(screen.getByRole("link", { name: /Anonymous chart/ }).textContent).toContain("已注销用户");
  expect(screen.getByRole("link", { name: "下一页" }).getAttribute("href")).toBe("/charts?cursor=next%2F%2B%3D");
  expect(screen.getAllByText("封面 · 未附带").length).toBe(2);
});
test("cover load failure keeps catalog card readable", () => {
  render(<MemoryRouter><Catalog loaderData={{ items: [{ ...chart, summary: { ...chart.summary, hasCover: true } }], nextCursor: null }} /></MemoryRouter>);
  const image = document.querySelector("img")!;
  expect(image.getAttribute("src")).toBe("/api/v1/charts/42/versions/selected/assets/cover");
  fireEvent.error(image);
  expect(screen.getByText("封面 · 未附带")).toBeTruthy();
});
test("public detail exposes original download, selected version, author and silent unsupported preview fallbacks", () => {
  render(<MemoryRouter><Detail loaderData={chart} /></MemoryRouter>);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Published title");
  expect(screen.getByRole("link", { name: "下载原始 ZIP" }).getAttribute("href")).toBe("/api/v1/charts/42/download");
  expect(screen.getByRole("link", { name: /作者：Alice/ }).getAttribute("href")).toBe("/u/alice");
  expect(screen.getByText("公开版本 ID：selected")).toBeTruthy();
  expect(screen.getByText("未附带（可静音预览）")).toBeTruthy();
  expect((screen.getByRole("option", { name: /难度 5/ }) as HTMLOptionElement).disabled).toBe(true);
});
test("empty catalog remains understandable", () => {
  render(<MemoryRouter><Catalog loaderData={{ items: [], nextCursor: null }} /></MemoryRouter>);
  expect(screen.getByText("还没有公开谱面。")).toBeTruthy();
  expect(screen.queryByRole("link", { name: "下一页" })).toBeNull();
});
function context() { const context = new RouterContextProvider(); context.set(apiContext, createApiClient("https://community.test")); return context; }
test("SSR loaders use only public API, no-store, and fetch fresh state for every navigation", async () => {
  const paths: string[] = []; let current = chart;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname; paths.push(path);
    expect(init?.cache).toBe("no-store");
    return Response.json(path.endsWith("/42") ? current : { items: [current], nextCursor: null });
  }));
  const ctx = context();
  const args = { context: ctx, params: { id: "42" } } as unknown as Parameters<typeof detailLoader>[0];
  expect(((await detailLoader(args)) as { data: PublicChartDto }).data.title).toBe("Published title");
  current = { ...chart, title: "Updated snapshot" };
  expect(((await detailLoader(args)) as { data: PublicChartDto }).data.title).toBe("Updated snapshot");
  const result = await catalogLoader({ context: ctx, url: new URL("https://community.test/charts") } as unknown as Parameters<typeof catalogLoader>[0]);
  expect(result.init?.headers).toMatchObject({ "Cache-Control": "private, no-store" });
  expect(catalogHeaders()).toMatchObject({ "Cache-Control": "private, no-store" });
  expect(paths).toEqual(["/api/v1/charts/42", "/api/v1/charts/42", "/api/v1/charts"]);
});
test.each([404, 503])("public detail error %s stays no-store and noindex without private fallback", async status => {
  const fetcher = vi.fn(async () => Response.json({ error: { code: "NOT_FOUND", message: "Unavailable" } }, { status }));
  vi.stubGlobal("fetch", fetcher);
  const result = await detailLoader({ context: context(), params: { id: "missing" } } as unknown as Parameters<typeof detailLoader>[0]).catch(error => error);
  expect(result.init).toMatchObject({ status, headers: { "Cache-Control": "private, no-store" } });
  expect(detailMeta({ loaderData: undefined } as unknown as Parameters<typeof detailMeta>[0])).toContainEqual({ name: "robots", content: "noindex" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test("detail metadata derives only published snapshot and catalog cursor pages are noindex", () => {
  const matches = [{ id: "root", loaderData: { origin: "https://community.test" } }];
  const head = detailMeta({ loaderData: chart, matches, location: { pathname: "/charts/42" } } as unknown as Parameters<typeof detailMeta>[0]);
  expect(JSON.stringify(head)).toContain("Published title");
  expect(JSON.stringify(head)).not.toContain("Private");
  expect(catalogMeta({ loaderData: { items: [chart] }, matches, location: { pathname: "/charts", search: "?cursor=next" } } as unknown as Parameters<typeof catalogMeta>[0])).toContainEqual({ name: "robots", content: "noindex" });
});

test("public card difficulty pills name the playable difficulty without relying on color", () => {
  render(<MemoryRouter><Catalog loaderData={{ items: [chart], nextCursor: null }} /></MemoryRouter>);
  const link = screen.getByRole("link", { name: /Published title/ });
  expect(link.textContent).toContain("EXPERT");
  expect(link.textContent).toContain("MASTER");
  expect(link.textContent).toContain("12+");
  expect(link.textContent).toContain("暂不支持预览");
});

test("public detail has a visible preview shortcut and sharing without eager preview assets", () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  render(<MemoryRouter><Detail loaderData={chart} /></MemoryRouter>);
  expect(screen.getByRole("link", { name: "预览谱面" }).getAttribute("href")).toBe("#chart-preview");
  expect(document.getElementById("chart-preview")?.getAttribute("tabindex")).toBe("-1");
  expect(screen.getByRole("button", { name: "分享谱面" })).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
});
test("detail without supported difficulties explains the limit and keeps download and sharing available", () => {
  render(<MemoryRouter><Detail loaderData={{ ...chart, summary: { ...chart.summary, difficulties: chart.summary.difficulties.map(row => ({ ...row, previewSupported: false })) } }} /></MemoryRouter>);
  expect(screen.queryByRole("link", { name: "预览谱面" })).toBeNull();
  expect(screen.getByText("此版本暂不支持在线预览，仍可下载原始 ZIP。")).toBeTruthy();
  expect(screen.getByRole("button", { name: "分享谱面" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "下载原始 ZIP" })).toBeTruthy();
});


test.each(["/en/charts/12345678-1234-4234-8234-123456789012/", "/en/Charts/12345678-1234-4234-8234-123456789012"])("legacy UUID %s redirects without looping while preserving locale and query", async path => {
  vi.stubGlobal("fetch", async () => Response.json(chart));
  const args = { context: context(), params: { id: "12345678-1234-4234-8234-123456789012" }, request: new Request(`https://community.test${path}?from=share`) } as unknown as Parameters<typeof detailLoader>[0];
  const response = await detailLoader(args);
  expect(response).toBeInstanceOf(Response);
  expect((response as Response).status).toBe(302);
  expect((response as Response).headers.get("location")).toBe("/en/charts/42?from=share");
  expect((response as Response).headers.get("cache-control")).toBe("private, no-store");
});
