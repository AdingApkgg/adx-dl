import { Hono, type Context } from "hono";
import { validator } from "hono/validator";
import { z } from "zod";
import { REPORT_CATEGORIES, REPORT_TEXT_MAX } from "@/shared/community-social";
import type { AppEnv } from "../app-env";
import { currentAuth } from "../auth/mount";
import { jsonError } from "../errors";
import { StorageUnavailableError } from "../storage/errors";
import { favoriteState, addFavorite, removeFavorite, listFavorites } from "../services/favorites";
import { createChartReport, listMyReports } from "../services/chart-reports";
export function socialStorage(c: Context<AppEnv>) { const ctx = c.get("services").storage; if (!ctx) throw new StorageUnavailableError(); return ctx; }
function privateRoutes() { return new Hono<AppEnv>().use(async (c, next) => {
  c.header("cache-control", "private, no-store"); c.header("x-robots-tag", "noindex, nofollow"); currentAuth(c); await next();
}); }
function page(c: Context<AppEnv>) { return { cursor: c.req.query("cursor"), ...(c.req.query("limit") !== undefined ? { limit: Number(c.req.query("limit")) } : {}) }; }
export const favoriteRoutes = privateRoutes()
  .get("/", async c => c.json(await listFavorites(socialStorage(c), currentAuth(c).user.id, page(c))))
  .get("/:id", async c => c.json(await favoriteState(socialStorage(c), currentAuth(c).user.id, c.req.param("id"))))
  .put("/:id", async c => c.json(await addFavorite(socialStorage(c), currentAuth(c).user.id, c.req.param("id"))))
  .delete("/:id", async c => c.json(await removeFavorite(socialStorage(c), currentAuth(c).user.id, c.req.param("id"))));
const reportInput = z.object({ versionId: z.string(), category: z.enum(REPORT_CATEGORIES), details: z.string().max(REPORT_TEXT_MAX * 2) }).strict();
export const myReportRoutes = privateRoutes()
  .get("/", async c => c.json(await listMyReports(socialStorage(c), currentAuth(c).user.id, page(c))))
  .post("/:id", validator("json", (value, c) => {
    const parsed = reportInput.safeParse(value); return parsed.success ? parsed.data : jsonError(c, 400, "BAD_REQUEST", "Invalid report");
  }), async c => c.json(await createChartReport(socialStorage(c), currentAuth(c).user.id, c.req.param("id"), c.req.valid("json"))));
