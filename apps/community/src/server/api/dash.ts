import { Hono } from "hono";
import { validator } from "hono/validator";
import { z } from "zod";
import type { AppEnv } from "../app-env";
import { currentAuth } from "../auth/mount";
import { isRecentLogin } from "../auth/recent-login";
import { jsonError } from "../errors";
import { dashAccess, dashOverview, dashUsers, dashCharts, dashPage, dashStatus, moderateChart } from "../services/dash";

import { listDashReports, reportFilter, resolveChartReport } from "../services/chart-reports";
import { socialStorage } from "./community-social";
const pageQuery = z.object({ cursor: z.string().optional(), limit: z.string().optional() }).strict();
const validatePageQuery = validator("query", (value, c) => {
  const parsed = pageQuery.safeParse(value);
  if (!parsed.success) return jsonError(c, 400, "BAD_REQUEST", "Invalid page");
  dashPage(parsed.data);
  return parsed.data;
});
const moderation = z.object({
  expectedRevision: z.number().int().min(1).max(2147483647),
  reason: z.string().trim().refine(value => [...value].length >= 1 && [...value].length <= 500),
}).strict();
export const dashRoutes = new Hono<AppEnv>()
  .use(async (c, next) => {
    const auth = currentAuth(c);
    if (!await dashAccess(c.get("services"), auth.user.id)) return jsonError(c, 403, "FORBIDDEN", "Forbidden");
    c.header("cache-control", "private, no-store");
    await next();
  })
  .get("/access", async c => {
    const access = await dashAccess(c.get("services"), currentAuth(c).user.id);
    return access ? c.json(access) : jsonError(c, 403, "FORBIDDEN", "Forbidden");
  })
  .get("/overview", async c => c.json(await dashOverview(c.get("services").db)))
  .get("/users", validatePageQuery, async c => c.json(await dashUsers(c.get("services").db, dashPage(c.req.valid("query")))))
  .get("/charts", validatePageQuery, async c => c.json(await dashCharts(c.get("services").db, dashPage(c.req.valid("query")))))
  .get("/status", async c => c.json(await dashStatus(c.get("services"))))
  .get("/reports", async c => c.json(await listDashReports(socialStorage(c), reportFilter(c.req.query("status")), {
    cursor: c.req.query("cursor"), ...(c.req.query("limit") !== undefined ? { limit: Number(c.req.query("limit")) } : {}),
  })))
  .post("/reports/:id/resolution", validator("json", (value, c) => {
    const parsed = z.object({ status: z.enum(["dismissed", "actioned"]), note: z.string().max(1000) }).strict().safeParse(value);
    return parsed.success ? parsed.data : jsonError(c, 400, "BAD_REQUEST", "Invalid resolution");
  }), async c => {
    const auth = currentAuth(c);
    if (!isRecentLogin(auth.session.createdAt)) return jsonError(c, 403, "REAUTH_REQUIRED", "Sign in again to continue");
    const access = await dashAccess(c.get("services"), auth.user.id);
    if (!access) return jsonError(c, 403, "FORBIDDEN", "Forbidden");
    return c.json(await resolveChartReport(socialStorage(c), { id: auth.user.id, publicId: access.publicId }, c.req.param("id"), c.req.valid("json")));
  })
  .post("/charts/:id/moderation", validator("json", (value, c) => {
    const parsed = moderation.safeParse(value);
    return parsed.success ? parsed.data : jsonError(c, 400, "BAD_REQUEST", "Invalid moderation request");
  }), async c => {
    const auth = currentAuth(c);
    if (!isRecentLogin(auth.session.createdAt)) return jsonError(c, 403, "REAUTH_REQUIRED", "Sign in again to continue");
    const services = c.get("services");
    const access = await dashAccess(services, auth.user.id);
    if (!access) return jsonError(c, 403, "FORBIDDEN", "Forbidden");
    if (!services.storage) return jsonError(c, 503, "STORAGE_UNAVAILABLE", "Storage unavailable");
    return c.json(await moderateChart(services.storage, { id: auth.user.id, publicId: access.publicId }, c.req.param("id"), c.req.valid("json")));
  });
