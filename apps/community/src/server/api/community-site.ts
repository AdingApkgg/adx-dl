import {Hono} from "hono";
import {validator} from "hono/validator";
import {z} from "zod";
import {noticeDraftSchema} from "@/shared/community-site";
import type {AppEnv} from "../app-env";
import {currentAuth} from "../auth/mount";
import {isRecentLogin} from "../auth/recent-login";
import {dashAccess} from "../services/dash";
import {jsonError} from "../errors";
import {socialStorage} from "./community-social";
import {getFeatured,listNotices,getNotice,saveNotice,setFeatured} from "../community/site";
const writeSchema=z.object({expectedRevision:z.number().int().min(0).max(2147483646),action:z.enum(["save","publish","withdraw"]),draft:noticeDraftSchema.optional(),confirm:z.literal(true)}).strict();
const admin=new Hono<AppEnv>().use(async(c,next)=>{
 c.header("cache-control","private, no-store");c.header("x-robots-tag","noindex, nofollow");
 const auth=currentAuth(c);if(!await dashAccess(c.get("services"),auth.user.id))return jsonError(c,403,"FORBIDDEN","Forbidden");
 if(c.req.method!=="GET"&&!isRecentLogin(auth.session.createdAt))return jsonError(c,403,"REAUTH_REQUIRED","Sign in again");
 await next();
}).get("/notices/:id",async c=>c.json(await getNotice(socialStorage(c),c.req.param("id"))))
 .get("/notices",async c=>c.json(await listNotices(socialStorage(c),true,c.req.query("cursor"))))
 .put("/notices/:id",validator("json",(v,c)=>{const p=writeSchema.safeParse(v);return p.success?p.data:jsonError(c,400,"BAD_REQUEST","Invalid notice");}),async c=>c.json(await saveNotice(socialStorage(c),currentAuth(c).user.id,c.req.param("id"),c.req.valid("json"))))
 .get("/featured",async c=>c.json(await getFeatured(socialStorage(c),true)))
 .put("/featured",validator("json",(v,c)=>{const p=z.object({expectedRevision:z.number().int().min(0).max(2147483646),ids:z.array(z.string()).max(6),confirm:z.literal(true)}).strict().safeParse(v);return p.success?p.data:jsonError(c,400,"BAD_REQUEST","Invalid featured list");}),async c=>c.json(await setFeatured(socialStorage(c),currentAuth(c).user.id,c.req.valid("json"))));
export const communitySiteRoutes=new Hono<AppEnv>().use(async(c,next)=>{c.header("cache-control","private, no-store");c.header("x-robots-tag","noindex, nofollow");await next();})
 .get("/notices",async c=>c.json(await listNotices(socialStorage(c),false,c.req.query("cursor"))))
 .get("/featured",async c=>c.json(await getFeatured(socialStorage(c))))
 .route("/dash",admin);
