import type { ComponentType } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { SocialNavigation, notificationFilterHref } from "@/client/components/social-ui";
import { PublicChartSearchForm } from "@/client/components/public-chart-browser";
import { NotificationIndicator } from "@/client/components/notification-indicator";
import Notifications from "@/client/routes/notifications";
import FollowingFeed from "@/client/routes/following-feed";
import { m } from "@/paraglide/messages.js";
import { createApiClient } from "@/shared/api-client";
import type { DiscussionNotification } from "@/shared/discussions";
import type { PublicChartDto } from "@/shared/charts";
import { makeQueryClient } from "@/shared/query-client";

const browser = vi.hoisted(() => ({ client: undefined as ReturnType<typeof makeQueryClient> | undefined }));
const api = createApiClient("https://community.test");
vi.mock("@/client/lib/browser", () => ({ getRenderApi: () => api, getBrowserApi: () => api, getBrowserQueryClient: () => browser.client }));
afterEach(() => vi.unstubAllGlobals());
const notice = (id: string, read = false, extra: Partial<DiscussionNotification> = {}): DiscussionNotification => ({ id, kind: "direct_reply", read, createdAt: "2026-10-21T01:00:00Z", eventAt: "2026-10-21T01:00:00Z", available: true, href: "/forum/1", topic: null, message: null, publicReason: null, ...extra });
const Notices = Notifications as unknown as ComponentType<{ loaderData: { userId: string; page: { items: DiscussionNotification[]; nextCursor: string | null; unreadCount: number; followingUnavailable?: boolean } } }>;
function view(items: DiscussionNotification[], { url = "/me/notifications", nextCursor = null as string | null, followingUnavailable = false, current = "viewer", indicator = false } = {}) {
  const client = makeQueryClient(); browser.client = client; client.setQueryData(["me"], { id: current, publicId: "1", status: "active" });
  const router = createMemoryRouter([{ path: "*", element: <Notices loaderData={{ userId: "viewer", page: { items, nextCursor, unreadCount: 9, followingUnavailable } }} /> }], { initialEntries: [url] });
  render(<QueryClientProvider client={client}>{indicator ? <MemoryRouter><NotificationIndicator /></MemoryRouter> : null}<RouterProvider router={router} /></QueryClientProvider>);
  return { router, client };
}

test.each(["feed", "following", "notifications"] as const)("social navigation identifies only the current %s page", view => {
  render(<MemoryRouter><SocialNavigation view={view} /></MemoryRouter>);
  const nav = screen.getByRole("navigation", { name: m.ui_social_navigation() });
  expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  expect(nav.querySelector('[aria-current="page"]')?.getAttribute("href")).toBe(`/me/${view}`);
});
test("notification filter changes retain the other dimension and discard the cursor", () => {
  expect(notificationFilterHref("?unread=true&kind=author_update&cursor=old", { unread: false })).toBe("/me/notifications?kind=author_update");
  expect(notificationFilterHref("?unread=true&cursor=old", { updates: true })).toBe("/me/notifications?unread=true&kind=author_update");
  expect(notificationFilterHref("?unread=true&kind=author_update&cursor=old", { updates: false })).toBe("/me/notifications?unread=true");
});
test("notification controls, empty results and next page reflect both URL filters", () => {
  view([], { url: "/me/notifications?unread=true&kind=author_update&cursor=old", nextCursor: "next" });
  const filters = screen.getByRole("region", { name: m.ui_social_notice_filters() });
  expect(within(filters).getByRole("link", { name: m.discussion_all() }).getAttribute("href")).toBe("/me/notifications?kind=author_update");
  expect((within(filters).getByRole("combobox", { name: m.ui_social_notice_kind() }) as HTMLSelectElement).value).toBe("author_update");
  const form = filters.querySelector("form")!; expect(form.querySelector('input[name="unread"]')?.getAttribute("value")).toBe("true"); expect(form.querySelector('[name="cursor"]')).toBeNull();
  const next = new URL(screen.getByRole("link", { name: m.chart_next() }).getAttribute("href")!, "https://community.test");
  expect(next.searchParams.get("unread")).toBe("true"); expect(next.searchParams.get("kind")).toBe("author_update"); expect(next.searchParams.get("cursor")).toBe("next");
  expect(screen.getByText(m.ui_social_notice_no_match())).toBeTruthy();
  expect((screen.getByRole("button", { name: m.discussion_read_page() }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(m.discussion_notifications());
});
test("batch read submits only this page's unread IDs and refreshes the shared unread indicator", async () => {
  const writes: unknown[] = []; let count = 9;
  vi.stubGlobal("fetch", vi.fn(async (_input: unknown, init?: RequestInit) => {
    if (init?.method === "POST") { writes.push(JSON.parse(String(init.body))); count = 7; return Response.json({ ok: true }); }
    return Response.json({ items: [], nextCursor: null, unreadCount: count });
  }));
  view([notice("one"), notice("already", true), notice("two")], { indicator: true });
  await screen.findByRole("status", { name: m.site_unread({ count: "9" }) });
  fireEvent.click(screen.getByRole("button", { name: m.discussion_read_page() }));
  await waitFor(() => expect(writes).toEqual([{ ids: ["one", "two"] }]));
  await screen.findByRole("status", { name: m.site_unread({ count: "7" }) });
  expect(screen.getByText(m.ui_social_notice_done())).toBeTruthy();
});
test("failed batch read retains unread state and shows an error without claiming success", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "STORAGE_BUSY", message: "busy" } }, { status: 503 })));
  view([notice("unread")]); fireEvent.click(screen.getByRole("button", { name: m.discussion_read_page() }));
  await screen.findByRole("alert"); expect(screen.queryByText(m.ui_social_notice_done())).toBeNull(); expect(document.querySelectorAll(".community-notification.is-unread")).toHaveLength(1);
});
test("unavailable notifications hide their old content and unsafe targets", () => {
  view([notice("hidden", false, { available: false, href: "https://evil.test", publicReason: "private hidden reason" }), notice("unsafe", true, { href: "https://evil.test" })]);
  expect(screen.queryByText("private hidden reason")).toBeNull(); expect(document.querySelector('a[href*="evil.test"]')).toBeNull(); expect(screen.getByText(m.discussion_unavailable())).toBeTruthy(); expect(screen.getByText(m.ui_social_notice_read())).toBeTruthy();
});
test("partial following failure is not a successfully empty notification center", () => {
  view([], { followingUnavailable: true }); expect(screen.getByRole("alert").textContent).toContain(m.following_unavailable()); expect(screen.queryByText(m.ui_social_notice_empty())).toBeNull();
});
test("retained notification data disappears on account change", async () => {
  const { client } = view([notice("private", false, { publicReason: "only original account" })]);
  expect(screen.getByText("only original account")).toBeTruthy();
  await act(async () => { client.setQueryData(["me"], { id: "different", status: "active" }); });
  expect(screen.queryByText("only original account")).toBeNull();
});
test("profile search locks the author without producing an unremovable chip", () => {
  render(<MemoryRouter><PublicChartSearchForm lockedAuthor base="/u/7" filters={{ q: "", sort: "updated", author: "7" }} /></MemoryRouter>);
  const form = screen.getByRole("search"); expect(form.querySelector('[name="author"]')).toBeNull(); expect(screen.queryByRole("link", { name: /#7/ })).toBeNull(); expect(form.getAttribute("action")).toBe("/u/7");
});
test("feed groups by UTC day, uses level-three cards and exposes author profiles", () => {
  const client = makeQueryClient(); client.setQueryData(["me"], { id: "viewer", status: "active" });
  const chart = { id: "chart", publicId: "2", title: "Grouped chart", artist: "artist", versionId: "v1", author: { id: "author", publicId: "7", name: "Author" }, summary: { hasCover: false, difficulties: [] }, tags: [] } as unknown as PublicChartDto;
  const Feed = FollowingFeed as unknown as ComponentType<{ loaderData: { userId: string; page: { items: { id: string; occurredAt: string; chart: PublicChartDto }[]; nextCursor: null } } }>;
  render(<QueryClientProvider client={client}><MemoryRouter><Feed loaderData={{ userId: "viewer", page: { items: [{ id: "a", occurredAt: "2026-10-21T00:00:00Z", chart }, { id: "b", occurredAt: "2026-10-21T20:00:00Z", chart: { ...chart, id: "chart2", publicId: "3" } }], nextCursor: null } }} /></MemoryRouter></QueryClientProvider>);
  expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1); expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(2); expect(screen.getAllByRole("link", { name: m.ui_social_visit_author({ name: "Author" }) })[0]?.getAttribute("href")).toBe("/u/7");
});
