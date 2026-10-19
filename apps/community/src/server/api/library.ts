import {requireActiveSocialUser} from "../services/social-page";
import {Hono,type Context} from "hono";
import {HTTPException} from "hono/http-exception";
import {z} from "zod";
import type {AppEnv} from "../app-env";
import {libraryId,libraryName,libraryDescription,libraryRevision,libraryPublicId} from "@/shared/library";
import {REPORT_CATEGORIES} from "@/shared/community-social";
import {currentAuth} from "../auth/mount";
import {isRecentLogin} from "../auth/recent-login";
import {dashAccess} from "../services/dash";
import {socialStorage} from "./community-social";
import {jsonError} from "../errors";
import {getPrivateList,listPrivateLists,saveList,changeListPublication} from "../library/service";
import {getPublicList,listPublicLists,copyPublicList} from "../library/public";
import {listDashLists,moderateList,reportList,listLibraryReports,resolveListReport,libraryStatus} from "../library/moderation";
const parse=<T>(schema:z.ZodType<T>,v:unknown):T=>{const r=schema.safeParse(v);if(!r.success)throw new HTTPException(400);return r.data;};
async function body<T>(c:Context<AppEnv>,schema:z.ZodType<T>){let v:unknown;try{v=await c.req.json();}catch{throw new HTTPException(400);}return parse(schema,v);}
const page=z.object({cursor:z.string().max(512).optional()}).strict();
const save=z.object({id:libraryId,expectedRevision:libraryRevision,name:libraryName,description:libraryDescription,entries:z.array(z.string().max(64)).max(200)}).strict();
const version=z.object({expectedRevision:libraryRevision}).strict();
const publicQuery=z.object({q:z.string().max(240).optional(),author:z.preprocess(v=>v===''?undefined:v,libraryPublicId.optional()),cursor:z.string().max(512).optional()}).strict();
const copyInput=z.object({id:libraryId,expectedRevision:libraryRevision,publicIds:z.array(libraryPublicId).max(200)}).strict();
const reportInput=z.object({category:z.enum(REPORT_CATEGORIES),details:z.string().min(1).max(1000)}).strict();
const dashQuery=z.object({q:z.string().max(120).optional(),cursor:z.string().max(512).optional()}).strict();
const reportQuery=z.object({status:z.enum(['open','resolved','all']).optional(),cursor:z.string().max(512).optional()}).strict();
const resolution=z.object({status:z.enum(['dismissed','actioned']),note:z.string().min(1).max(1000)}).strict();
const moderation=z.object({expectedRevision:libraryRevision,publicationRevision:libraryRevision.refine(n=>n>0),hidden:z.boolean(),reason:z.string().min(1).max(1000)}).strict();
function base(){return new Hono<AppEnv>().use(async(c,next)=>{c.header('cache-control','private, no-store');c.header('x-robots-tag','noindex, nofollow');await next();});}
export const libraryRoutes=base().use(async(c,next)=>{await requireActiveSocialUser(c.get('services').db,currentAuth(c).user.id);await next();})
 .get('/',async c=>{return c.json(await listPrivateLists(socialStorage(c),currentAuth(c).user.id,parse(page,c.req.query()).cursor));})
 .get('/reports',async c=>{return c.json(await listLibraryReports(socialStorage(c),{...parse(page,c.req.query()),status:'all'},currentAuth(c).user.id));})
 .put('/:id',async c=>{const input=await body(c,save);if(input.id!==c.req.param('id'))throw new HTTPException(400);return c.json(await saveList(socialStorage(c),currentAuth(c).user.id,input));})
 .get('/:id',async c=>{return c.json(await getPrivateList(socialStorage(c),currentAuth(c).user.id,parse(libraryId,c.req.param('id'))));})
 .post('/:id/publish',async c=>{return c.json(await changeListPublication(socialStorage(c),currentAuth(c).user.id,parse(libraryId,c.req.param('id')),(await body(c,version)).expectedRevision,'publish'));})
 .post('/:id/withdraw',async c=>{return c.json(await changeListPublication(socialStorage(c),currentAuth(c).user.id,parse(libraryId,c.req.param('id')),(await body(c,version)).expectedRevision,'withdraw'));})
 .post('/:id/delete',async c=>{return c.json(await changeListPublication(socialStorage(c),currentAuth(c).user.id,parse(libraryId,c.req.param('id')),(await body(c,version)).expectedRevision,'delete'));});
export const publicListRoutes=base()
 .get('/',async c=>{return c.json(await listPublicLists(socialStorage(c),parse(publicQuery,c.req.query())));})
 .get('/:id',async c=>{return c.json(await getPublicList(socialStorage(c),parse(libraryPublicId,c.req.param('id')),parse(page,c.req.query()).cursor));})
 .post('/:id/copy',async c=>{return c.json(await copyPublicList(socialStorage(c),currentAuth(c).user.id,parse(libraryPublicId,c.req.param('id')),await body(c,copyInput)));})
 .post('/:id/reports',async c=>{return c.json(await reportList(socialStorage(c),currentAuth(c).user.id,parse(libraryPublicId,c.req.param('id')),await body(c,reportInput)));});
export const dashLibraryRoutes=base().use(async(c,next)=>{const auth=currentAuth(c);if(!await dashAccess(c.get('services'),auth.user.id))return jsonError(c,403,'FORBIDDEN','Forbidden');if(!['GET','HEAD'].includes(c.req.method)&&!isRecentLogin(auth.session.createdAt))return jsonError(c,403,'REAUTH_REQUIRED','Sign in again to continue');await next();})
 .get('/',async c=>{return c.json(await listDashLists(socialStorage(c),parse(dashQuery,c.req.query())));})
 .get('/status',async c=>{return c.json(await libraryStatus(socialStorage(c)));})
 .get('/reports',async c=>{return c.json(await listLibraryReports(socialStorage(c),parse(reportQuery,c.req.query())));})
 .post('/reports/:id/resolution',async c=>{return c.json(await resolveListReport(socialStorage(c),currentAuth(c).user.id,parse(libraryId,c.req.param('id')),await body(c,resolution)));})
 .post('/:id/moderation',async c=>{return c.json(await moderateList(socialStorage(c),currentAuth(c).user.id,parse(libraryId,c.req.param('id')),await body(c,moderation)));});
