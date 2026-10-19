import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AppEnv } from "../app-env";
import { currentAuth } from "../auth/mount";
import { chartAssetResponse, resolveChartAsset } from "../charts/assets";
import { appendChartVersion, createChart, deleteChart, deleteChartVersion, getChart, listCharts, updateChart } from "../charts/service";
import { StorageUnavailableError } from "../storage/errors";

import { listWorkbench, sourceBinding, versionFingerprint } from "../charts/workbench";
import { publishChart, withdrawChart } from "../charts/publication";
const expected = z.number().int().min(1).max(2147483647);
const create = z.object({ fileId: z.string() }).strict();
const append = create.extend({ expectedRevision: expected }).strict();
const remove = z.object({ expectedRevision: expected }).strict();
const patch = z.object({ expectedRevision: expected, title: z.string().optional(), artist: z.string().optional(),
  description: z.string().optional(), credits: z.string().optional(), tags: z.array(z.string()).max(64).optional(),
  releaseNote: z.object({ versionId: z.string(), text: z.string() }).strict().optional(), currentVersionId: z.string().optional() }).strict();
function storage(c: Context<AppEnv>) {
  const ctx = c.get("services").storage;
  if (!ctx) throw new StorageUnavailableError();
  return ctx;
}
async function body<T>(c: Context<AppEnv>, schema: z.ZodType<T>): Promise<T> {
  let value: unknown;
  try { value = await c.req.json(); } catch { throw new HTTPException(400, { message: "Invalid chart request" }); }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HTTPException(400, { message: "Invalid chart request" });
  return parsed.data;
}
export const chartRoutes = new Hono<AppEnv>()
  .use(async (c, next) => {
    c.header("cache-control", "private, no-store");
    c.header("x-content-type-options", "nosniff");
    c.header("x-robots-tag", "noindex, nofollow");
    currentAuth(c);
    await next();
  })
  .get("/workbench", async c => c.json(await listWorkbench(storage(c),currentAuth(c).user.id,{q:c.req.query("q"),status:c.req.query("status"),cursor:c.req.query("cursor"),changed:c.req.query("changed")==="1",warnings:c.req.query("warnings")==="1",pending:c.req.query("pending")==="1"})))
  .get("/bindings/:fileId", async c => c.json(await sourceBinding(storage(c),currentAuth(c).user.id,c.req.param("fileId"))))
  .get("/:id/versions/:versionId/fingerprint", async c => c.json(await versionFingerprint(storage(c),currentAuth(c).user.id,c.req.param("id"),c.req.param("versionId"))))
  .put("/:id/publication", async c => c.json(await publishChart(
    storage(c), currentAuth(c).user.id, c.req.param("id"),
    await body(c, z.object({ expectedRevision: expected, versionId: z.string(), confirmOriginalArchive: z.literal(true) }).strict()),
  )))
  .delete("/:id/publication", async c => c.json(await withdrawChart(
    storage(c), currentAuth(c).user.id, c.req.param("id"), (await body(c, remove)).expectedRevision,
  )))
  .post("/", async c => c.json(await createChart(storage(c), currentAuth(c).user.id, (await body(c, create)).fileId), 201))
  .get("/", async c => {
    const raw = c.req.query("limit");
    return c.json(await listCharts(storage(c), currentAuth(c).user.id,
      { q: c.req.query("q"), status: c.req.query("status"), cursor: c.req.query("cursor"), ...(raw !== undefined ? { limit: Number(raw) } : {}) }));
  })
  .get("/:id", async c => c.json(await getChart(storage(c), currentAuth(c).user.id, c.req.param("id"))))
  .patch("/:id", async c => c.json(await updateChart(storage(c), currentAuth(c).user.id, c.req.param("id"), await body(c, patch))))
  .post("/:id/versions", async c => c.json(await appendChartVersion(storage(c), currentAuth(c).user.id, c.req.param("id"), await body(c, append)), 201))
  .delete("/:id", async c => {
    await deleteChart(storage(c), currentAuth(c).user.id, c.req.param("id"), (await body(c, remove)).expectedRevision);
    return c.body(null, 204);
  })
  .delete("/:id/versions/:versionId", async c => {
    await deleteChartVersion(storage(c), currentAuth(c).user.id, c.req.param("id"), c.req.param("versionId"), (await body(c, remove)).expectedRevision);
    return c.body(null, 204);
  })
  .on(["GET", "HEAD"], "/:id/versions/:versionId/assets/:role", async c => {
    const ctx = storage(c);
    const asset = await resolveChartAsset(ctx, currentAuth(c).user.id, c.req.param("id"), c.req.param("versionId"), c.req.param("role"));
    return chartAssetResponse(ctx, asset, c.req.raw, c.req.raw.signal);
  });
