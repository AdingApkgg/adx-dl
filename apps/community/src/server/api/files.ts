import { Hono } from "hono";
import type { AppEnv } from "../app-env";
import { currentAuth } from "../auth/mount";
import { deleteFile, getFile, resolvePrivateFile, representationResponse } from "../storage/files";
import { StorageUnavailableError } from "../storage/errors";
export const fileRoutes = new Hono<AppEnv>()
  .use(async (c, next) => {
    currentAuth(c);
    await next();
  })
  .get("/:id", async (c) => {
    const ctx = c.get("services").storage;
    if (!ctx) throw new StorageUnavailableError();
    return c.json(await getFile(ctx, currentAuth(c).user.id, c.req.param("id")));
  })
  .delete("/:id", async (c) => {
    const ctx = c.get("services").storage;
    if (!ctx) throw new StorageUnavailableError();
    await deleteFile(ctx, currentAuth(c).user.id, c.req.param("id"));
    return c.body(null, 204);
  })
  .on(["GET", "HEAD"], "/:id/:representation", async (c) => {
    const ctx = c.get("services").storage;
    if (!ctx) throw new StorageUnavailableError();
    const rep = c.req.param("representation");
    if (rep !== "content" && rep !== "preview") return c.notFound();
    const file = await resolvePrivateFile(ctx, currentAuth(c).user.id, c.req.param("id"), rep);
    return representationResponse(ctx, file, c.req.raw, c.req.raw.signal);
  });
