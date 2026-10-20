import type { ComponentType } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router";
import { expect, test, vi } from "vitest";
import { LibraryNavigation } from "@/client/components/library-ui";
import Library from "@/client/routes/library";
import PublicLists from "@/client/routes/public-lists";
import { m } from "@/paraglide/messages.js";
import { createApiClient } from "@/shared/api-client";
import type { LibraryPage, LibrarySummary, PublicListSummary } from "@/shared/library";
import { makeQueryClient } from "@/shared/query-client";

const api = createApiClient("https://community.test");
vi.mock("@/client/lib/browser", () => ({ getRenderApi: () => api, getBrowserApi: () => api }));
const PublicListsPage = PublicLists as unknown as ComponentType<{ loaderData: LibraryPage<PublicListSummary> }>;
const PrivateLibraryPage = Library as unknown as ComponentType<{ loaderData: { userId: string; page: { kind: "lists"; page: LibraryPage<LibrarySummary> } } }>;

test("public list search reflects URL filters, resets pagination and preserves filters on the next page", () => {
  const router = createMemoryRouter([{ path: "*", element: <PublicListsPage loaderData={{ items: [], nextCursor: "next-page" }} /> }], { initialEntries: ["/lists?q=%E6%98%9F&author=12&cursor=old-page"] });
  render(<RouterProvider router={router} />);
  expect((screen.getByRole("searchbox", { name: m.ui_library_list_search() }) as HTMLInputElement).value).toBe("星");
  expect((screen.getByRole("textbox", { name: m.library_author_number() }) as HTMLInputElement).value).toBe("12");
  const form = screen.getByRole("search", { name: m.ui_library_list_search() });
  expect(form.getAttribute("action")).toBe("/lists");
  expect(form.getAttribute("method")).toBe("get");
  expect(form.querySelector('[name="cursor"]')).toBeNull();
  expect(screen.getAllByRole("link", { name: m.ui_clear_filters() }).every(link => link.getAttribute("href") === "/lists")).toBe(true);
  const next = new URL(screen.getByRole("link", { name: m.library_more() }).getAttribute("href")!, "https://community.test");
  expect(next.searchParams.get("q")).toBe("星");
  expect(next.searchParams.get("author")).toBe("12");
  expect(next.searchParams.get("cursor")).toBe("next-page");
  expect(screen.getByText(m.ui_library_no_results())).toBeTruthy();
});

test.each(["lists", "favorites", "reports"] as const)("library navigation exposes only the %s view as current", view => {
  render(<MemoryRouter><LibraryNavigation view={view} /></MemoryRouter>);
  const navigation = screen.getByRole("navigation", { name: m.ui_library_navigation() });
  const labels = { lists: m.library_my_lists(), favorites: m.my_favorites(), reports: m.library_reports() };
  expect(within(navigation).getByRole("link", { name: labels[view] }).getAttribute("aria-current")).toBe("page");
  expect(navigation.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
});

test("private list summaries describe a saved publication without promising current public access", () => {
  const client = makeQueryClient();
  client.setQueryData(["me"], { id: "owner", status: "active" });
  const base = { revision: 2, description: "", updatedAt: "2026-10-21T00:00:00.000Z", count: 3 };
  const items: LibrarySummary[] = [
    { ...base, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", publicId: "7", name: "Saved publication", published: true },
    { ...base, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", publicId: null, name: "Private draft", published: false },
  ];
  render(<QueryClientProvider client={client}><MemoryRouter><PrivateLibraryPage loaderData={{ userId: "owner", page: { kind: "lists", page: { items, nextCursor: null } } }} /></MemoryRouter></QueryClientProvider>);
  const articles = screen.getAllByRole("article");
  expect(within(articles[0]!).getByText(m.library_has_publication())).toBeTruthy();
  expect(within(articles[1]!).getByText(m.library_private())).toBeTruthy();
  expect(screen.queryByRole("link", { name: m.library_view_public() })).toBeNull();
  expect(document.querySelector('a[href="/lists/7"]')).toBeNull();
  expect(screen.getByText(m.ui_library_page_count({ count: "2" }))).toBeTruthy();
});
