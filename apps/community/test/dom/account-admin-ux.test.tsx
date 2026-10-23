import type { ComponentType } from "react";
import { dehydrate, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SettingsNavigation } from "@/client/components/settings-navigation";
import { DashboardNavigation } from "@/client/components/dashboard-navigation";
import { DashPager, dashFilterHref } from "@/client/components/dash-ui";
import Login from "@/client/routes/login";
import SettingsAccount from "@/client/routes/settings-account";
import SettingsProfile from "@/client/routes/settings-profile";
import Dash from "@/client/routes/dash";
import DashLists from "@/client/routes/dash-lists";
import { m } from "@/paraglide/messages.js";
import { createApiClient } from "@/shared/api-client";
import { makeQueryClient } from "@/shared/query-client";

const actions = vi.hoisted(() => ({ social: vi.fn(), passkey: vi.fn(), add: vi.fn(), remove: vi.fn(), unlink: vi.fn(), signOut: vi.fn(), clearImports: vi.fn(), reset: vi.fn() }));
vi.mock("@/client/lib/auth-client", () => ({ authClient: { signIn: { social: actions.social, passkey: actions.passkey }, passkey: { addPasskey: actions.add, deletePasskey: actions.remove }, unlinkAccount: actions.unlink, signOut: actions.signOut } }));
vi.mock("@/client/lib/turnstile", () => ({ useTurnstile: () => ({ ref: { current: null }, token: "fixture-token", failed: false, reset: actions.reset }) }));
vi.mock("@/client/imports/provider", () => ({ clearDeviceImports: actions.clearImports }));
const api = createApiClient("https://community.test");
vi.mock("@/client/lib/browser", () => ({ getRenderApi: () => api, getBrowserApi: () => api }));
const USER = { id: "owner", publicId: "1", name: "Owner", image: null, status: "active", isAdmin: true, createdAt: "2026-10-24T00:00:00Z", deletionPurgeAt: null };
const PROFILE = { name: "Owner", bio: "Private profile draft", image: null, avatarRevision: 0, onboardedAt: USER.createdAt };
const LOGINS = { accounts: [{ id: "google-owned", provider: "google", email: "owner@example.test", createdAt: USER.createdAt }], passkeys: [] };
const SESSIONS = { sessions: [{ id: "current", browser: "Current browser", os: "Test OS", current: true, country: null, createdAt: USER.createdAt, lastActiveAt: USER.createdAt }, { id: "other-device", browser: "Other browser", os: "Remote OS", current: false, country: null, createdAt: USER.createdAt, lastActiveAt: USER.createdAt }] };
const OPTIONS = { turnstileSiteKey: "fixture", qq: { available: false, botQq: null }, awmc: { available: true } };
type HydratedPage = ComponentType<{ loaderData: { userId: string; dehydratedState: ReturnType<typeof dehydrate> } }>;
const Account = SettingsAccount as unknown as HydratedPage, Profile = SettingsProfile as unknown as HydratedPage, LoginPage = Login as unknown as HydratedPage;
let requests: { method: string; path: string; body: unknown }[];
beforeEach(() => {
  vi.clearAllMocks(); requests = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname, method = init?.method ?? "GET";
    requests.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (method !== "GET") return Response.json({ revoked: 1, ok: true });
    if (path === "/api/v1/me") return Response.json(USER);
    if (path === "/api/v1/me/logins") return Response.json(LOGINS);
    if (path === "/api/v1/me/sessions") return Response.json(SESSIONS);
    if (path === "/api/v1/me/profile") return Response.json(PROFILE);
    if (path === "/api/v1/login-options") return Response.json(OPTIONS);
    throw new Error(`Unexpected fixture read: ${path}`);
  }));
});
afterEach(() => vi.unstubAllGlobals());
function view(kind: "login" | "account" | "profile", url?: string, me: typeof USER | null = USER) {
  const client = makeQueryClient(); client.setQueryData(["me"], me); client.setQueryData(["me", "profile"], PROFILE); client.setQueryData(["me", "logins"], LOGINS); client.setQueryData(["me", "sessions"], SESSIONS); client.setQueryData(["login-options"], OPTIONS);
  const Component = kind === "login" ? LoginPage : kind === "profile" ? Profile : Account;
  const router = createMemoryRouter([{ path: "*", element: <Component loaderData={{ userId: USER.id, dehydratedState: dehydrate(client) }} /> }], { initialEntries: [url ?? (kind === "login" ? "/login" : `/settings/${kind}`)] });
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return { client, router };
}
test.each(["profile", "account"] as const)("settings navigation marks only %s current", view => {
  render(<MemoryRouter><SettingsNavigation view={view} /></MemoryRouter>);
  const nav = screen.getByRole("navigation", { name: m.ui_account_navigation() });
  expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1); expect(nav.querySelector('[aria-current="page"]')?.getAttribute("href")).toBe(`/settings/${view}`);
});
test("external login transport failure recovers its button and preserves a safe reauthentication return", async () => {
  actions.social.mockRejectedValueOnce(new Error("network"));
  view("login", "/login?reauth=1&next=%2Fcharts%2F1&error=state_mismatch");
  fireEvent.click(screen.getByRole("button", { name: m.login_google() }));
  await waitFor(() => expect((screen.getByRole("button", { name: m.login_google() }) as HTMLButtonElement).disabled).toBe(false));
  expect(actions.social).toHaveBeenCalledWith({ provider: "google", callbackURL: "/charts/1#login=google", newUserCallbackURL: "/onboarding?next=%2Fcharts%2F1#login=google", errorCallbackURL: "/login?next=%2Fcharts%2F1&reauth=1" });
  expect(screen.getByText(m.error_unknown())).toBeTruthy(); expect(screen.getByText(m.error_social_failed())).toBeTruthy();
});
test("unsafe login destination is never sent to the authorization provider", async () => {
  actions.social.mockResolvedValue({ error: { code: "invalid_code" } }); view("login", "/login?next=https%3A%2F%2Fevil.test%2Fsecret", null);
  fireEvent.click(screen.getByRole("button", { name: m.login_awmc() })); await waitFor(() => expect(actions.social).toHaveBeenCalled());
  const payload = actions.social.mock.calls[0]![0]; expect(payload.callbackURL).toBe("/#login=awmc"); expect(JSON.stringify(payload)).not.toContain("evil.test");
});
test("explicit passkey rejection recovers the sign-in control", async () => {
  actions.passkey.mockRejectedValue(new Error("transport")); view("login"); fireEvent.click(screen.getByRole("button", { name: m.login_passkey_sign_in() }));
  await screen.findByText(m.error_unknown()); expect((screen.getByRole("button", { name: m.login_passkey_sign_in() }) as HTMLButtonElement).disabled).toBe(false);
});
test("passkey registration transport rejection resets verification and never leaves signup busy", async () => {
  actions.add.mockRejectedValue(new Error("transport")); view("login", "/login", null);
  fireEvent.change(screen.getByRole("textbox", { name: m.login_nickname() }), { target: { value: "New creator" } }); fireEvent.click(screen.getByRole("button", { name: m.login_passkey_signup() }));
  await screen.findByText(m.error_unknown()); expect((screen.getByRole("button", { name: m.login_passkey_signup() }) as HTMLButtonElement).disabled).toBe(false); expect(actions.reset).toHaveBeenCalledTimes(1);
});
test.each(["account", "profile"] as const)("retained %s content is hidden after an account switch", async kind => {
  const { client } = view(kind);
  expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
  await act(async () => { client.setQueryData(["me"], { ...USER, id: "another-account", publicId: "2" }); });
  await waitFor(() => expect(screen.queryByRole("heading", { level: 1 })).toBeNull()); expect(document.body.textContent).not.toContain("owner@example.test"); expect(document.body.textContent).not.toContain("Private profile draft");
});
test("sign-out transport rejection leaves the session and device data intact", async () => {
  actions.signOut.mockRejectedValue(new Error("offline")); view("account"); fireEvent.click(screen.getByRole("button", { name: m.settings_sign_out() }));
  await screen.findByText(m.error_unknown()); expect(actions.clearImports).not.toHaveBeenCalled(); expect(screen.getByText("owner@example.test", { exact: false })).toBeTruthy(); expect((screen.getByRole("button", { name: m.settings_sign_out() }) as HTMLButtonElement).disabled).toBe(false);
});
test("revoking a device targets only its actual session and keeps the current device actionless", async () => {
  view("account"); expect(screen.getAllByRole("button", { name: m.settings_revoke() })).toHaveLength(1); fireEvent.click(screen.getByRole("button", { name: m.settings_revoke() }));
  await waitFor(() => expect(requests.filter(r => r.method === "DELETE").map(r => r.path)).toEqual(["/api/v1/me/sessions/other-device"])); expect(screen.getByText(m.settings_device_current())).toBeTruthy();
});
test("last-login-method rejection retains the binding and exposes the real safeguard", async () => {
  actions.unlink.mockResolvedValue({ error: { code: "LAST_LOGIN_METHOD" } }); view("account"); fireEvent.click(screen.getByRole("button", { name: m.settings_unlink() }));
  await screen.findByText(m.error_last_login_method()); expect(actions.unlink).toHaveBeenCalledWith({ accountId: "google-owned" }); expect(screen.getByText("owner@example.test", { exact: false })).toBeTruthy(); expect((screen.getByRole("button", { name: m.settings_delete_submit() }) as HTMLButtonElement).disabled).toBe(true);
});
test("dashboard filter changes retain independent ticket context and reset pagination", () => {
  expect(dashFilterHref("/dash/reports", "?status=open&ticket=ticket-one&cursor=old", { status: "all" })).toBe("/dash/reports?status=all&ticket=ticket-one");
});
test("dashboard pager retains scope and refuses history from another filter", () => {
  render(<MemoryRouter initialEntries={[{ pathname: "/dash/users", search: "?status=active&cursor=10", state: { dashScope: "/dash/users?status=other", cursors: ["999"] } }]}><DashPager base="/dash/users" nextCursor="20" /></MemoryRouter>);
  expect(screen.getByRole("link", { name: m.chart_previous() }).getAttribute("href")).toBe("/dash/users?status=active"); expect(screen.getByRole("link", { name: m.chart_next() }).getAttribute("href")).toBe("/dash/users?status=active&cursor=20");
});
test("mobile dashboard navigation names its actual current section", () => {
  render(<MemoryRouter initialEntries={["/en/dash/status"]}><DashboardNavigation /></MemoryRouter>); expect(screen.getByText(`${m.dash_title()} · ${m.dash_status()}`)).toBeTruthy();
});
test("dashboard root hides an old administrator's outlet after identity change", async () => {
  const client = makeQueryClient(); client.setQueryData(["me"], USER); const Page = Dash as unknown as ComponentType<{ loaderData: { publicId: string } }>;
  const router = createMemoryRouter([{ path: "*", element: <Page loaderData={{ publicId: "1" }} /> }]); render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  expect(screen.getByRole("heading", { level: 1 })).toBeTruthy(); await act(async () => { client.setQueryData(["me"], { ...USER, id: "other-admin", publicId: "2" }); }); await waitFor(() => expect(screen.queryByRole("heading", { level: 1 })).toBeNull());
});
test("admin list search reflects the URL, preserves ticket context and leaves pagination out of the form", () => {
  const client = makeQueryClient(); client.setQueryData(["me"], USER);
  const Page = DashLists as unknown as ComponentType<{ loaderData: unknown }>;
  const router = createMemoryRouter([{ path: "*", element: <Page loaderData={{ userId: USER.id, lists: { items: [], nextCursor: "next" }, reports: { items: [] }, status: { ready: true, lists: 0, publications: 0, pendingControls: 0 } }} /> }], { initialEntries: ["/dash/lists?q=needle&status=all&publicId=7&ticket=focused&cursor=old"] });
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  const form = screen.getByRole("search", { name: m.library_find() }); expect((within(form).getByRole("searchbox") as HTMLInputElement).value).toBe("needle"); expect(form.querySelector('[name="cursor"]')).toBeNull();
  for (const [name, value] of [["status", "all"], ["publicId", "7"], ["ticket", "focused"]]) expect(form.querySelector(`[name="${name}"]`)?.getAttribute("value")).toBe(value);
  const next = new URL(screen.getByRole("link", { name: m.library_more() }).getAttribute("href")!, "https://community.test"); expect(next.searchParams.get("q")).toBe("needle"); expect(next.searchParams.get("ticket")).toBe("focused"); expect(next.searchParams.get("cursor")).toBe("next");
});
