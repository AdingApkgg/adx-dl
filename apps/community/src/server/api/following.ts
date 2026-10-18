import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AppEnv } from "../app-env";
import { currentAuth } from "../auth/mount";
import { isPublicChartId } from "@/shared/chart-public-id";
import { StorageUnavailableError } from "../storage/errors";
import { getFollow, listFollowing, setFollow } from "../following/relationships";
import { listFeed } from "../following/events";
const query=z.object({cursor:z.string().max(512).optional()}).strict();
const input=z.object({expectedRevision:z.number().int().min(0).max(2147483646),following:z.boolean(),notify:z.boolean()}).strict();
const parse=<T>(schema:z.ZodType<T>,value:unknown):T=>{const r=schema.safeParse(value);if(!r.success)throw new HTTPException(400);return r.data;};
export const followingRoutes=new Hono<AppEnv>()
 .use(async(c,next)=>{currentAuth(c);c.header("cache-control","private, no-store");c.header("x-robots-tag","noindex, nofollow");await next();})
 .get("/",async c=>{const s=c.get("services").storage;if(!s)throw new StorageUnavailableError();return c.json(await listFollowing(s,currentAuth(c).user.id,parse(query,c.req.query()).cursor));})
 .get("/feed",async c=>{const s=c.get("services").storage;if(!s)throw new StorageUnavailableError();return c.json(await listFeed(s,currentAuth(c).user.id,parse(query,c.req.query()).cursor));})
 .get("/authors/:publicId",async c=>{const s=c.get("services").storage;if(!s)throw new StorageUnavailableError();return c.json(await getFollow(s,currentAuth(c).user.id,parse(z.string().refine(isPublicChartId),c.req.param("publicId"))));})
 .put("/authors/:publicId",async c=>{const s=c.get("services").storage;if(!s)throw new StorageUnavailableError();let value:unknown;try{value=await c.req.json();}catch{throw new HTTPException(400);}return c.json(await setFollow(s,currentAuth(c).user.id,parse(z.string().refine(isPublicChartId),c.req.param("publicId")),parse(input,value)));});
