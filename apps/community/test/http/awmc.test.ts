import { expect, test } from "bun:test";

import { startBuiltServer } from "./server";

test("configured AWMC renders in all languages and starts a state-bound authorization without exposing its secret", async () => {
  const server = await startBuiltServer({ AWMC_CLIENT_ID: "public-awmc-client", AWMC_CLIENT_SECRET: "private-awmc-fixture-secret-0123456789" });
  try {
    for (const [path, label] of [["/login", "用 AWMC 登录"], ["/en/login", "Sign in with AWMC"], ["/ja/login", "AWMC でログイン"]]) {
      const response = await fetch(server.url(path!));
      const html = await response.text();
      expect(response.status).toBe(200);
      expect(html).toContain(label!);
      expect(html).not.toContain("private-awmc-fixture-secret");
    }
    const response = await fetch(server.url("/api/auth/sign-in/social"), {
      method: "POST", headers: { "content-type": "application/json", origin: server.origin },
      body: JSON.stringify({ provider: "awmc", callbackURL: "/", errorCallbackURL: "/login" }),
    });
    expect(response.status).toBe(200);
    const target = new URL((await response.json()).url);
    expect(target.origin + target.pathname).toBe("https://bbs.wmc.pub/audapi/oauth2/authorize");
    expect(target.searchParams.get("client_id")).toBe("public-awmc-client");
    expect(target.searchParams.get("redirect_uri")).toBe(server.url("/api/auth/callback/awmc"));
    expect(target.searchParams.get("scope")).toBe("user:read");
    expect(target.searchParams.get("state")).toBeTruthy();
    expect(target.searchParams.get("code_challenge_method")).toBe("S256");
    expect(target.searchParams.has("client_secret")).toBe(false);
  } finally { await server.stop(); }
}, 30000);

test("unconfigured AWMC is hidden and cannot start authorization", async () => {
  const server = await startBuiltServer({ AWMC_CLIENT_ID: "", AWMC_CLIENT_SECRET: "" });
  try {
    expect(await (await fetch(server.url("/api/v1/login-options"))).json()).not.toHaveProperty("awmc");
    expect(await (await fetch(server.url("/login"))).text()).not.toContain("用 AWMC 登录");
    const response = await fetch(server.url("/api/auth/sign-in/social"), {
      method: "POST", headers: { "content-type": "application/json", origin: server.origin },
      body: JSON.stringify({ provider: "awmc", callbackURL: "/" }),
    });
    expect(response.ok).toBe(false);
  } finally { await server.stop(); }
}, 30000);
