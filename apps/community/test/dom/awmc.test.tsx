import { dehydrate, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";

import Login from "@/client/routes/login";
import SettingsAccount from "@/client/routes/settings-account";
import { m } from "@/paraglide/messages.js";
import { createApiClient } from "@/shared/api-client";
import { makeQueryClient } from "@/shared/query-client";

const actions = vi.hoisted(() => ({ social: vi.fn(), linkSocial: vi.fn() }));
vi.mock("@/client/lib/auth-client", () => ({ authClient: { signIn: { social: actions.social }, linkSocial: actions.linkSocial } }));
const api = createApiClient("https://community.test");
vi.mock("@/client/lib/browser", () => ({ getBrowserApi: () => api, getRenderApi: () => api }));
const USER = { id: "user-id", publicId: "1", name: "Existing user", image: null, status: "active", createdAt: "2026-10-17T00:00:00Z", deletionPurgeAt: null };

afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

function page(kind: "login" | "account", enabled: boolean) {
  const path = kind === "login" ? "/login?next=%2Fcharts%2F1&reauth=1" : "/settings/account";
  window.history.replaceState(null, "", path);
  const queryClient = makeQueryClient();
  const options = { turnstileSiteKey: "site", qq: { available: false, botQq: null }, ...(enabled ? { awmc: { available: true } } : {}) };
  queryClient.setQueryData(["me"], USER);
  queryClient.setQueryData(["login-options"], options);
  const logins = { accounts: [{ id: "g", provider: "google", email: null, createdAt: USER.createdAt }], passkeys: [] };
  const sessions = { sessions: [] };
  queryClient.setQueryData(["me", "logins", USER.id], logins);
  queryClient.setQueryData(["me", "sessions", USER.id], sessions);
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
    if (path === "/api/v1/me/logins") return Response.json(logins);
    if (path === "/api/v1/me/sessions") return Response.json(sessions);
    if (path === "/api/v1/me") return Response.json(USER);
    throw new Error(`Unexpected fixture request: ${path}`);
  }));
  const Component = (kind === "login" ? Login : SettingsAccount) as unknown as ComponentType<{ loaderData: { userId: string; dehydratedState: ReturnType<typeof dehydrate> } }>;
  render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[path]}><Component loaderData={{ userId: USER.id, dehydratedState: dehydrate(queryClient) }} /></MemoryRouter></QueryClientProvider>);
  return userEvent.setup();
}

test("AWMC login sends the selected provider and preserves destination and reauthentication after failure", async () => {
  actions.social.mockResolvedValue({ error: { code: "invalid_code" } });
  const user = page("login", true);
  const button = screen.getByRole("button", { name: m.login_awmc() });
  await user.click(button);
  expect(actions.social).toHaveBeenCalledWith({ provider: "awmc", callbackURL: "/charts/1#login=awmc", newUserCallbackURL: "/onboarding?next=%2Fcharts%2F1#login=awmc", errorCallbackURL: "/login?next=%2Fcharts%2F1&reauth=1" });
  expect(await screen.findByText(m.error_social_failed())).toBeTruthy();
  expect((button as HTMLButtonElement).disabled).toBe(false);
});

test("AWMC binding is explicit and old-session rejection offers reauthentication", async () => {
  actions.linkSocial.mockResolvedValue({ error: { code: "REAUTH_REQUIRED" } });
  const user = page("account", true);
  await user.click(screen.getByRole("button", { name: m.settings_link_awmc() }));
  expect(actions.linkSocial).toHaveBeenCalledWith({ provider: "awmc", callbackURL: "/settings/account", errorCallbackURL: "/settings/account" });
  expect(await screen.findByText(m.error_reauth_required())).toBeTruthy();
  expect(screen.getByRole("link", { name: m.settings_reauth() }).getAttribute("href")).toContain("reauth=1");
});

for (const kind of ["login", "account"] as const) {
  test(`AWMC ${kind} action stays hidden when credentials are disabled`, () => {
    page(kind, false);
    expect(screen.queryByRole("button", { name: kind === "login" ? m.login_awmc() : m.settings_link_awmc() })).toBeNull();
  });
}
