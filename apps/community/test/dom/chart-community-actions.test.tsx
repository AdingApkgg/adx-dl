import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { m } from "@/paraglide/messages.js";
import { ChartCommunityActions } from "@/client/components/chart-community-actions";
import type { PublicChartDto } from "@/shared/charts";
import { makeQueryClient } from "@/shared/query-client";
const chart: PublicChartDto = { id: "12345678-1234-4234-8234-123456789012", publicId: "1", versionId: "12345678-1234-4234-8234-123456789013", ordinal: 1,
  title: "Public", artist: "Artist", publishedAt: "2026-10-18T00:00:00Z", updatedAt: "2026-10-18T00:00:00Z", sourceSize: 100, author: null,
  summary: { title: "Public", artist: "Artist", maidataMd5Base64: "", difficulties: [], warnings: [], audio: null, hasCover: false } };
function view(active: boolean) {
  const client = makeQueryClient(); client.setQueryData(["me"], active ? { id: "viewer", publicId: "1", name: "Viewer", status: "active" } : null);
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/charts/1"]}><ChartCommunityActions chart={chart} /></MemoryRouter></QueryClientProvider>);
}
afterEach(() => vi.unstubAllGlobals());
test("anonymous visitors see a sign-in return link without private API reads", () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); view(false);
  expect(screen.getByRole("link", { name: m.social_login() }).getAttribute("href")).toContain("next=%2Fcharts%2F1");
  expect(fetcher).not.toHaveBeenCalled();
});
test("favorite mutations send JSON headers and update only the account-scoped query", async () => {
  const methods: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET"; methods.push(method);
    if (method !== "GET") expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    return Response.json({ favorited: method === "PUT" });
  }));
  view(true);
  await waitFor(() => expect((screen.getByRole("button", { name: m.favorite_add() }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: m.favorite_add() }));
  await screen.findByRole("button", { name: m.favorite_remove() });
  expect(methods).toEqual(["GET", "PUT"]);
});
test("a report submission carries the displayed version and never calls moderation", async () => {
  const requests: { url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    return Response.json(url.includes("/reports/") ? { id: "ticket", publicId: "1", versionId: chart.versionId, status: "open" } : { favorited: false });
  }));
  view(true); fireEvent.click(screen.getByRole("button", { name: m.report_chart() }));
  fireEvent.change(screen.getByRole("textbox", { name: m.report_details() }), { target: { value: "File is broken" } });
  fireEvent.click(screen.getByRole("button", { name: m.report_submit() }));
  await screen.findByText(m.report_received());
  expect(requests.find(request => request.url.includes("/reports/"))?.body).toEqual({ versionId: chart.versionId, category: "other", details: "File is broken" });
  expect(requests.some(request => request.url.includes("/moderation"))).toBe(false);
});
