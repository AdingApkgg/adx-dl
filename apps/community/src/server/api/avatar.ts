import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../app-env";
import { currentAuth } from "../auth/mount";
import { setAvatar } from "../storage/avatars";
import { StorageError, StorageUnavailableError } from "../storage/errors";
const save = z
  .object({
    fileId: z.uuid(),
    expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
const remove = save.omit({ fileId: true });
export const avatarRoutes = new Hono<AppEnv>()
  .put("/", async (c) => {
    const ctx = c.get("services").storage;
    const userId = currentAuth(c).user.id;
    if (!ctx) throw new StorageUnavailableError();
    const parsed = save.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new StorageError(400, "INVALID_UPLOAD");
    return c.json(await setAvatar(ctx, userId, parsed.data, c.req.header("idempotency-key") ?? ""));
  })
  .delete("/", async (c) => {
    const ctx = c.get("services").storage;
    const userId = currentAuth(c).user.id;
    if (!ctx) throw new StorageUnavailableError();
    const parsed = remove.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new StorageError(400, "INVALID_UPLOAD");
    return c.json(
      await setAvatar(
        ctx,
        userId,
        { fileId: null, ...parsed.data },
        c.req.header("idempotency-key") ?? "",
      ),
    );
  });
