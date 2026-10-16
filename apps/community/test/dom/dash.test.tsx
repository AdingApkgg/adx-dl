import { toast } from "@astrodx/ui/components/sonner";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType } from "react";
import { createMemoryRouter, MemoryRouter, RouterProvider, useLoaderData } from "react-router";
import { afterEach, expect, test, vi } from "vitest";

import { AccountMenu } from "@/client/components/account-menu";
import { DashError } from "@/client/components/dash-ui";
import DashCharts from "@/client/routes/dash-charts";
import DashStatusPage from "@/client/routes/dash-status";
import DashUsers from "@/client/routes/dash-users";
import { m } from "@/paraglide/messages.js";
import { createApiClient } from "@/shared/api-client";
import type { DashChart, DashChartsPage, DashStatus, DashUsersPage } from "@/shared/dash";
import { makeQueryClient } from "@/shared/query-client";

const api = createApiClient("https://community.test");
vi.mock("@/client/lib/browser", () => ({ getBrowserApi: () => api, getRenderApi: () => api }));
vi.mock("@/client/lib/auth-client", () => ({ authClient: { signOut: vi.fn() } }));
const ChartsPage = DashCharts as unknown as ComponentType<{ loaderData: DashChartsPage }>;
const UsersPage = DashUsers as unknown as ComponentType<{ loaderData: DashUsersPage }>;
const StatusPage = DashStatusPage as unknown as ComponentType<{ loaderData: DashStatus }>;
const published: DashChart = {
  id: "internal-chart-id", publicId: "42", revision: 7, title: "Published snapshot", artist: "Public artist",
  author: { publicId: "9", name: "Author" }, publishedAt: "2026-10-16T00:00:00.000Z",
  status: "public", moderation: null, pending: false,
};
const moderated: DashChart = {
  ...published, revision: 8, status: "moderated",
  moderation: { reason: "Reviewed reason", actorPublicId: "1", createdAt: "2026-10-16T01:00:00.000Z" },
};
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function renderCharts(reply: () => Response | Promise<Response>, start = published, path = "/dash/charts?cursor=24") {
  const requests: { path: string; method: string; body: unknown; cache: RequestCache | undefined }[] = [];
  const success = vi.spyOn(toast, "success");
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ path: new URL(String(input)).pathname, method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : null, cache: init?.cache });
    return reply();
  }));
  const loader = vi.fn(() => ({ items: [start], nextCursor: null }));
  const router = createMemoryRouter([{
    path: "*", loader,
    Component: () => <ChartsPage loaderData={useLoaderData() as DashChartsPage} />,
  }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  await screen.findByRole("button", { name: m.dash_take_down() });
  return { requests, loader, success };
}
function openConfirmation(reason = "  Reviewed reason  ") {
  fireEvent.click(screen.getByRole("button", { name: m.dash_take_down() }));
  fireEvent.change(screen.getByRole("textbox", { name: m.dash_reason() }), { target: { value: reason } });
  fireEvent.click(screen.getByRole("checkbox"));
  return screen.getByRole("button", { name: m.dash_confirm() }) as HTMLButtonElement;
}

test.each([undefined, false, true])("account menu only offers localized dash to an active authorized user (%s)", async (isAdmin) => {
  window.history.replaceState(null, "", "/en/");
  const client = makeQueryClient();
  client.setQueryData(["me"], { id: "user-id", publicId: "1", name: "Admin", image: null, status: "active", isAdmin });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/en/"]}><AccountMenu /></MemoryRouter></QueryClientProvider>);
  await userEvent.setup().click(screen.getByRole("button", { name: m.nav_account_menu({ name: "Admin" }) }));
  const entry = screen.queryByRole("menuitem", { name: m.dash_title() });
  if (isAdmin) expect(entry?.getAttribute("href")).toBe("/en/dash");
  else expect(entry).toBeNull();
});

test("a pending-deletion account cannot use an old admin marker to reveal the dash entry", async () => {
  const client = makeQueryClient();
  client.setQueryData(["me"], { id: "user-id", publicId: "1", name: "Admin", image: null, status: "pending_deletion", isAdmin: true });
  render(<QueryClientProvider client={client}><MemoryRouter><AccountMenu /></MemoryRouter></QueryClientProvider>);
  await userEvent.setup().click(screen.getByRole("button", { name: m.nav_account_menu({ name: "Admin" }) }));
  expect(screen.queryByRole("menuitem", { name: m.dash_title() })).toBeNull();
});

test("a forbidden dash renders denial without administrative controls or raw error text", () => {
  render(<MemoryRouter><DashError error={{ status: 403, statusText: "Forbidden", internal: false, data: { message: "/private/storage/secret" } }} /></MemoryRouter>);
  expect(screen.getByRole("heading", { name: m.dash_denied_title() })).toBeTruthy();
  expect(screen.queryByText(/private.storage.secret/)).toBeNull();
  expect(screen.queryByRole("button", { name: m.dash_take_down() })).toBeNull();
  expect(screen.getByRole("link", { name: m.error_home() }).getAttribute("href")).toBe("/");
});

test("user rows show public identity and counts without rendering provider or session fields", () => {
  const user = { publicId: "9", name: "Author", image: null, status: "active" as const, createdAt: "2026-10-16T00:00:00Z", charts: 3, publicCharts: 1,
    email: "private-email@example.invalid", qq: "private-qq", ipAddress: "192.0.2.99", token: "private-session" };
  render(<MemoryRouter><UsersPage loaderData={{ items: [user], nextCursor: "9" }} /></MemoryRouter>);
  expect(screen.getByRole("link", { name: "Author · #9" }).getAttribute("href")).toBe("/u/9");
  expect(screen.getByText(m.dash_user_charts({ total: "3", published: "1" }))).toBeTruthy();
  for (const privateValue of [user.email, user.qq, user.ipAddress, user.token]) expect(document.body.textContent).not.toContain(privateValue);
  expect(screen.getByRole("link", { name: m.chart_next() }).getAttribute("href")).toBe("/dash/users?cursor=9");
});

test("moderated rows retain the public snapshot and audit reason without public file or action links", () => {
  const chart = { ...moderated, privateTitle: "Secret later edit", privateArtist: "Secret artist", sourceKey: "private/blob.zip" };
  render(<RouterProvider router={createMemoryRouter([{ path: "*", element: <ChartsPage loaderData={{ items: [chart], nextCursor: null }} /> }])} />);
  expect(screen.getByRole("heading", { name: /Published snapshot/ })).toBeTruthy();
  expect(screen.getByText("Reviewed reason")).toBeTruthy();
  expect(screen.getByText(m.dash_moderated_by({ id: "1", date: "2026-10-16 01:00:00 UTC" }))).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Published snapshot" })).toBeNull();
  expect(screen.queryByRole("button", { name: m.dash_take_down() })).toBeNull();
  for (const value of [chart.privateTitle, chart.privateArtist, chart.sourceKey]) expect(document.body.textContent).not.toContain(value);
});

test("takedown requires a nonblank bounded reason and an explicit checkbox before a single revision-bound request", async () => {
  const { requests, success } = await renderCharts(() => Response.json(moderated));
  fireEvent.click(screen.getByRole("button", { name: m.dash_take_down() }));
  const submit = screen.getByRole("button", { name: m.dash_confirm() }) as HTMLButtonElement;
  const reason = screen.getByRole("textbox", { name: m.dash_reason() });
  expect(submit.disabled).toBe(true);
  fireEvent.change(reason, { target: { value: "Reviewed reason" } });
  expect(submit.disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.change(reason, { target: { value: " \n " } });
  expect(submit.disabled).toBe(true);
  fireEvent.change(reason, { target: { value: "界".repeat(501) } });
  expect(submit.disabled).toBe(true);
  expect(requests).toHaveLength(0);
  fireEvent.change(reason, { target: { value: "  Reviewed reason  " } });
  fireEvent.click(submit);
  await waitFor(() => expect(success).toHaveBeenCalledWith(m.dash_taken_down()));
  expect(requests).toEqual([{ path: "/api/v1/dash/charts/internal-chart-id/moderation", method: "POST", body: { expectedRevision: 7, reason: "Reviewed reason" }, cache: "no-store" }]);
});

test("cancelling takedown clears the reason and confirmation without sending a request", async () => {
  const { requests } = await renderCharts(() => Response.json(moderated));
  openConfirmation();
  fireEvent.click(screen.getByRole("button", { name: m.dash_cancel() }));
  fireEvent.click(screen.getByRole("button", { name: m.dash_take_down() }));
  expect((screen.getByRole("textbox", { name: m.dash_reason() }) as HTMLTextAreaElement).value).toBe("");
  expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  expect((screen.getByRole("button", { name: m.dash_confirm() }) as HTMLButtonElement).disabled).toBe(true);
  expect(requests).toHaveLength(0);
});

test.each(["REAUTH_REQUIRED", "SESSION_NOT_FRESH"])("%s preserves the localized page and cursor in its recent-login link", async (code) => {
  window.history.replaceState(null, "", "/ja/dash/charts?cursor=24");
  const { requests, loader, success } = await renderCharts(() => Response.json({ error: { code, message: "Do not show raw auth details" } }, { status: 403 }), published, "/ja/dash/charts?cursor=24");
  fireEvent.click(openConfirmation());
  const login = await screen.findByRole("link", { name: m.settings_reauth() });
  const href = new URL(login.getAttribute("href")!, window.location.origin);
  expect(href.pathname).toBe("/ja/login");
  expect(href.searchParams.get("next")).toBe("/ja/dash/charts?cursor=24");
  expect(href.searchParams.get("reauth")).toBe("1");
  await waitFor(() => expect(loader.mock.calls.length).toBeGreaterThan(1));
  expect((screen.getByRole("textbox", { name: m.dash_reason() }) as HTMLTextAreaElement).value).toBe("  Reviewed reason  ");
  expect(requests).toHaveLength(1);
  expect(success).not.toHaveBeenCalled();
});

test.each(["lost", "pending", "missing-pending", "still-public"])("%s moderation responses never claim success or automatically replay POST", async (kind) => {
  const { requests, success } = await renderCharts(() => {
    if (kind === "lost") throw new TypeError("Connection lost after commit");
    if (kind === "pending") return Response.json({ ...moderated, pending: true });
    if (kind === "missing-pending") { const { pending: _pending, ...missing } = moderated; return Response.json(missing); }
    return Response.json(published);
  });
  fireEvent.click(openConfirmation());
  await screen.findByText(m.dash_unconfirmed());
  expect(success).not.toHaveBeenCalled();
  expect(requests).toHaveLength(1);
  expect((screen.getByRole("textbox", { name: m.dash_reason() }) as HTMLTextAreaElement).value).toBe("  Reviewed reason  ");
});

test("a stale chart revision reports conflict, refreshes state and never announces a takedown", async () => {
  const { requests, loader, success } = await renderCharts(() => Response.json({ error: { code: "CHART_CHANGED", message: "Raw conflict" } }, { status: 409 }));
  fireEvent.click(openConfirmation());
  await screen.findByText(m.dash_conflict());
  await waitFor(() => expect(loader.mock.calls.length).toBeGreaterThan(1));
  expect(success).not.toHaveBeenCalled();
  expect(requests).toHaveLength(1);
});

test("missing role heartbeats and absent backup history remain unknown without suggesting success or recovery acceptance", () => {
  const state: DashStatus = {
    capturedAt: "2026-10-16T00:00:00Z", checks: [{ name: "db", status: "ok" }],
    roles: [{ role: "control", heartbeatAgeSeconds: -1, ready: false }],
    queues: { storageDead: null, mediaPurgeDead: null, purgeIncomplete: 0, revoking: 0 },
    journal: { exportedSequence: "0", pending: 0, exportedAt: null }, maintenance: { active: false },
    backup: { status: "unknown", startedAt: null, finishedAt: null, lastSuccessAt: null, manifestSha256: null, originalCount: null, bytes: null },
  };
  render(<MemoryRouter><StatusPage loaderData={state} /></MemoryRouter>);
  const role = screen.getByText(m.dash_role_control()).closest("div")!;
  expect(role.textContent).toContain(m.dash_unavailable());
  expect(role.textContent).toContain(m.dash_unknown());
  expect(role.textContent).not.toContain("-1.0s");
  const backup = screen.getByText(m.dash_backup_state()).closest("div")!;
  expect(within(backup).getByText(m.dash_unknown())).toBeTruthy();
  expect(screen.queryByText(m.dash_backup_succeeded(), { exact: true })).toBeNull();
  expect(screen.getByText(m.dash_backup_hint())).toBeTruthy();
});
