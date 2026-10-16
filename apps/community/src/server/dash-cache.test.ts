import { expect, test } from "bun:test";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { createApp } from "./app";
import { testAppDeps } from "./testing/app-deps";

// React Router installs document and single-fetch handlers after createApp, as these fixtures do.
test("all dashboard document/data responses override public caching and remain noindex, including redirects and errors", async () => {
  for (const status of [200, 302, 403, 503] as const) {
    const app = createApp(testAppDeps().deps);
    app.get("*", (c) => c.text("dashboard fixture", status as ContentfulStatusCode, {
      "Cache-Control": "public, max-age=3600", ...(status === 302 ? { Location: "/login" } : {}),
    }));
    for (const prefix of ["", "/zh", "/en", "/ja"]) for (const suffix of ["", "/", "/users", "/charts", "/status"]) {
      for (const extension of ["", ".data"]) {
        if (suffix === "/" && extension) continue;
        const path = `${prefix}/dash${suffix}${extension}`;
        const response = await app.request(path);
        expect(response.status).toBe(status);
        expect(response.headers.get("cache-control"), path).toBe("private, no-store");
        expect(response.headers.get("x-robots-tag"), path).toBe("noindex, nofollow");
      }
    }
  }
});

test("unauthenticated administrative API errors receive privacy headers before the access check", async () => {
  const app = createApp(testAppDeps().deps);
  for (const endpoint of ["access", "overview", "users", "charts", "status"]) {
    const response = await app.request(`/api/v1/dash/${endpoint}`);
    expect(response.status, endpoint).toBe(401);
    expect(response.headers.get("cache-control"), endpoint).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag"), endpoint).toBe("noindex, nofollow");
  }
});

test("dashboard response policy leaves public pages and similarly named paths unchanged", async () => {
  const app = createApp(testAppDeps().deps);
  app.get("*", (c) => c.text("public fixture", 200, { "Cache-Control": "public, max-age=60" }));
  for (const path of ["/", "/charts", "/en/charts", "/dashboard", "/en/dashboard", "/dash.data-other"]) {
    const response = await app.request(path);
    expect(response.headers.get("cache-control"), path).toBe("public, max-age=60");
    expect(response.headers.get("x-robots-tag"), path).toBeNull();
  }
});
