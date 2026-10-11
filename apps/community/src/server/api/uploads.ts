import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AppEnv } from "../app-env";
import { currentAuth } from "../auth/mount";
import { readUploadPartBody } from "../middleware/body-limit";
import { StorageError, StorageUnavailableError } from "../storage/errors";
import { isUploadPartRequest, putUploadPart, withUploadPartPermit } from "../storage/parts";
import { cancelUpload, completeUpload, getUpload, initUpload } from "../storage/uploads";
const input = z
  .object({
    purpose: z.enum(["avatar", "chart-source"]),
    name: z.string(),
    size: z.number(),
    sha256: z.string(),
  })
  .strict();
export const uploadRoutes = new Hono<AppEnv>()
  .use(async (c, next) => {
    currentAuth(c);
    await next();
  })
  .post("/", async (c) => {
    const ctx = c.get("services").storage;
    if (!ctx) throw new StorageUnavailableError();
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw new StorageError(400, "INVALID_UPLOAD");
    }
    const parsed = input.safeParse(body);
    if (!parsed.success) throw new StorageError(400, "INVALID_UPLOAD");
    return c.json(
      await initUpload(
        ctx,
        currentAuth(c).user.id,
        parsed.data,
        c.req.header("idempotency-key") ?? "",
      ),
      201,
    );
  })
  .post("/:id/complete", async (c) => {
    const ctx = c.get("services").storage;
    if (!ctx) throw new StorageUnavailableError();
    const result = await completeUpload(ctx, currentAuth(c).user.id, c.req.param("id"));
    return c.json(result, result.state === "ready" ? 200 : 202);
  })
  .get("/:id", async (c) => {
    const ctx = c.get("services").storage;
    if (!ctx) throw new StorageUnavailableError();
    return c.json(await getUpload(ctx, currentAuth(c).user.id, c.req.param("id")));
  })
  .delete("/:id", async (c) => {
    const ctx = c.get("services").storage;
    if (!ctx) throw new StorageUnavailableError();
    await cancelUpload(ctx, currentAuth(c).user.id, c.req.param("id"));
    return c.body(null, 204);
  })
  .put("/:id/parts/:index", async (c) => {
    if (!isUploadPartRequest(c.req.method, c.req.path)) throw new StorageError(404, "NOT_FOUND");
    if (!/^application\/octet-stream(\s*;|$)/i.test(c.req.header("content-type") ?? ""))
      throw new HTTPException(415, {
        message: "Parts require application/octet-stream",
      });
    const ctx = c.get("services").storage;
    if (!ctx) throw new StorageUnavailableError();
    const userId = currentAuth(c).user.id;
    return withUploadPartPermit(userId, async () => {
      const bytes = await readUploadPartBody(c.req.raw);
      await putUploadPart(
        ctx,
        userId,
        c.req.param("id"),
        Number(c.req.param("index")),
        bytes,
        c.req.header("x-part-sha256") ?? "",
      );
      return c.body(null, 204);
    });
  });
