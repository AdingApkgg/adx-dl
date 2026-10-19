import {publicChartFiltersFromParams,publicChartSearchParams} from "@/shared/public-chart-search";
import {HTTPException} from "hono/http-exception";
import {randomPublicChart,containingPublicLists} from "../discovery/catalog";
import { Hono, type Context } from "hono";
import type { AppEnv } from "../app-env";
import {
  suggestPublicChartTags, relatedPublicCharts,
  getPublicChart,
  listPublicCharts,
  resolvePublicChartAsset,
  resolvePublicChartDownload,
} from "../charts/publication";
import { chartAssetResponse } from "../charts/assets";
import { representationResponse } from "../storage/files";
import { StorageUnavailableError } from "../storage/errors";
import { createPublicStreamLimiter } from "../charts/public-streams";
import { rateLimitKeyForIp } from "../middleware/client-ip";
const downloads = createPublicStreamLimiter();
const assets = createPublicStreamLimiter({ global: 128, perIp: 32 });
function storage(c: Context<AppEnv>) {
  const ctx = c.get("services").storage;
  if (!ctx) throw new StorageUnavailableError();
  return ctx;
}
function filters(c:Context<AppEnv>){try{return Object.fromEntries(publicChartSearchParams(publicChartFiltersFromParams(new URL(c.req.url).searchParams)));}catch{throw new HTTPException(400);}}
export const publicChartRoutes = new Hono<AppEnv>()
  .use(async (c, next) => {
    c.header("cache-control", "private, no-store");
    c.header("x-content-type-options", "nosniff");
    await next();
  })
  .get("/", async (c) =>
    c.json(
      await listPublicCharts(storage(c), {
        cursor: c.req.query("cursor"),
        ...filters(c),
        ...(c.req.query("limit") !== undefined ? { limit: Number(c.req.query("limit")) } : {}),
      }),
    ),
  )
  .get("/tags", async c => c.json(await suggestPublicChartTags(storage(c), c.req.query("q") ?? "")))
  .get("/random",async c=>c.json(await randomPublicChart(storage(c),filters(c))))
  .get("/:id/public-lists",async c=>c.json(await containingPublicLists(storage(c),c.req.param("id"))))
  .get("/:id/related", async c => c.json(await relatedPublicCharts(storage(c), c.req.param("id"))))
  .get("/:id", async (c) => c.json(await getPublicChart(storage(c), c.req.param("id"))))
  .on(["GET", "HEAD"], "/:id/download", async (c) => {
    const ctx = storage(c),
      file = await resolvePublicChartDownload(ctx, c.req.param("id"), c.req.query("expectedVersion"));
    return downloads(rateLimitKeyForIp(c.get("clientIp") ?? "unknown"), c.req.raw, () =>
      representationResponse(ctx, file, c.req.raw, c.req.raw.signal),
    );
  })
  .on(["GET", "HEAD"], "/:id/versions/:versionId/assets/:role", async (c) => {
    const ctx = storage(c),
      asset = await resolvePublicChartAsset(
        ctx,
        c.req.param("id"),
        c.req.param("versionId"),
        c.req.param("role"),
      );
    return assets(rateLimitKeyForIp(c.get("clientIp") ?? "unknown"), c.req.raw, () =>
      chartAssetResponse(ctx, asset, c.req.raw),
    );
  });
