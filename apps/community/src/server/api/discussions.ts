import { Hono, type Context } from "hono";
import { isPublicChartId } from "@/shared/chart-public-id";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { AppEnv } from "../app-env";
import { currentAuth } from "../auth/mount";
import { jsonError } from "../errors";
import { isRecentLogin } from "../auth/recent-login";
import { dashAccess } from "../services/dash";
import { requireActiveSocialUser } from "../services/social-page";
import { StorageUnavailableError } from "../storage/errors";
import { listBoards, listTopics, getTopic, createTopic, editTopic, removeTopic, createForumReply, setSubscription } from "../discussions/forum";
import { listChartDiscussion, chartReplies, createChartMessage, editMessage, removeMessage, focusMessage } from "../discussions/messages";
import { createReport, listReports, resolveReport, moderate, updateBoard, listModeration } from "../discussions/moderation";
import { listNotifications, readNotifications, myDiscussions } from "../discussions/notifications";
const uuid=z.string().uuid().transform(v=>v.toLowerCase()),publicId=z.string().refine(isPublicChartId),expected=z.number().int().min(1).max(2147483646);
const text=(max:number)=>z.string().max(max*2).refine(v=>[...v.trim()].length>=1&&[...v.trim()].length<=max);
const key=z.string().min(8).max(128).regex(/^[\w-]+$/);
const timestamp=z.number().int().min(0).max(2147483647),difficulty=z.number().int().min(1).max(7);
const charts=z.array(publicId).max(3).refine(v=>new Set(v).size===v.length);
const topicCreate=z.object({idempotencyKey:key,boardId:z.string().min(1).max(50),title:text(100),body:text(10000),chartIds:charts}).strict();
const topicEdit=topicCreate.omit({idempotencyKey:true,boardId:true}).extend({expectedRevision:expected}).strict();
const messageCreate=z.object({idempotencyKey:key,body:text(2000),replyToId:uuid.optional(),difficulty:difficulty.optional(),timestampMs:timestamp.optional(),subscribe:z.boolean().optional()}).strict();
const chartCreate=messageCreate.omit({subscribe:true}).extend({versionId:uuid,rootId:uuid.optional()}).strict();
const messageEdit=z.object({expectedRevision:expected,body:text(2000),difficulty:difficulty.nullable().optional(),timestampMs:timestamp.nullable().optional()}).strict();
const remove=z.object({expectedRevision:expected}).strict();
const cursor=z.string().max(600).optional();
const bool=z.enum(["true","false"]).transform(v=>v==="true").optional();
const listQuery=z.object({board:z.string().max(50).optional(),q:z.string().max(240).refine(v=>[...v].length<=120).optional(),sort:z.enum(["activity","published"]).optional(),unanswered:bool,chart:publicId.optional(),cursor}).strict();
const chartQuery=z.object({versionId:uuid.optional(),difficulty:z.coerce.number().int().min(1).max(7).optional(),cursor}).strict();
const report=z.object({targetType:z.enum(["chart_comment","forum_topic","forum_reply"]),targetId:uuid,category:z.enum(["copyright","inappropriate","broken","other"]),details:text(500)}).strict();
const moderation=z.object({expectedRevision:expected,action:z.enum(["hide","lock","unlock","pin","unpin","move"]),reason:text(500),publicReason:text(500),boardId:z.string().max(50).optional(),pin:z.number().int().min(1).max(3).optional()}).strict();
function storage(c:Context<AppEnv>){const s=c.get("services").storage;if(!s)throw new StorageUnavailableError();return s;}
function parse<T>(schema:z.ZodType<T>,value:unknown):T{const r=schema.safeParse(value);if(!r.success)throw new HTTPException(400,{message:"Invalid discussion request"});return r.data;}
async function body<T>(c:Context<AppEnv>,schema:z.ZodType<T>){let value:unknown;try{value=await c.req.json();}catch{throw new HTTPException(400);}return parse(schema,value);}
async function me(c:Context<AppEnv>){const a=currentAuth(c);await requireActiveSocialUser(c.get("services").db,a.user.id);return a.user.id;}
async function admin(c:Context<AppEnv>,write=false){const a=currentAuth(c);if(!await dashAccess(c.get("services"),a.user.id))throw new HTTPException(403);if(write&&!isRecentLogin(a.session.createdAt))throw new HTTPException(403,{res:jsonError(c,403,"REAUTH_REQUIRED","Sign in again to continue")});return me(c);}
const viewer=(c:Context<AppEnv>)=>c.get("auth")?.user.id;
const id=(v:string)=>parse(uuid,v),numberId=(v:string)=>parse(publicId,v);
export const discussionRoutes=new Hono<AppEnv>()
.use(async(c,next)=>{c.header("cache-control","private, no-store");c.header("x-robots-tag","noindex, nofollow");c.header("x-content-type-options","nosniff");await next();})
.get("/boards",async c=>c.json(await listBoards(storage(c))))
.get("/topics",async c=>c.json(await listTopics(storage(c),parse(listQuery,c.req.query()),viewer(c))))
.post("/topics",async c=>c.json(await createTopic(storage(c),await me(c),await body(c,topicCreate)),201))
.get("/topics/:publicId",async c=>{const q=parse(z.object({cursor}).strict(),c.req.query());return c.json(await getTopic(storage(c),numberId(c.req.param("publicId")),q.cursor,viewer(c)));})
.patch("/topics/:publicId",async c=>c.json(await editTopic(storage(c),await me(c),numberId(c.req.param("publicId")),await body(c,topicEdit))))
.delete("/topics/:publicId",async c=>c.json(await removeTopic(storage(c),await me(c),numberId(c.req.param("publicId")),(await body(c,remove)).expectedRevision)))
.post("/topics/:publicId/replies",async c=>c.json(await createForumReply(storage(c),await me(c),numberId(c.req.param("publicId")),await body(c,messageCreate.omit({difficulty:true,timestampMs:true}).strict())),201))
.get("/topics/:publicId/focus/:messageId",async c=>c.json(await focusMessage(storage(c),{topic:numberId(c.req.param("publicId"))},id(c.req.param("messageId")),viewer(c))))
.put("/topics/:publicId/subscription",async c=>c.json(await setSubscription(storage(c),await me(c),numberId(c.req.param("publicId")),(await body(c,z.object({subscribed:z.boolean()}).strict())).subscribed)))
.get("/charts/:publicId",async c=>c.json(await listChartDiscussion(storage(c),numberId(c.req.param("publicId")),parse(chartQuery,c.req.query()))))
.post("/charts/:publicId/messages",async c=>c.json(await createChartMessage(storage(c),await me(c),numberId(c.req.param("publicId")),await body(c,chartCreate)),201))
.get("/charts/:publicId/roots/:rootId/replies",async c=>{const q=parse(chartQuery.omit({difficulty:true}).strict(),c.req.query());return c.json(await chartReplies(storage(c),numberId(c.req.param("publicId")),id(c.req.param("rootId")),q.versionId,q.cursor));})
.get("/charts/:publicId/focus/:messageId",async c=>{const q=parse(z.object({versionId:uuid.optional()}).strict(),c.req.query());return c.json(await focusMessage(storage(c),{chart:numberId(c.req.param("publicId")),version:q.versionId},id(c.req.param("messageId")),viewer(c)));})
.patch("/messages/:id",async c=>c.json(await editMessage(storage(c),await me(c),id(c.req.param("id")),await body(c,messageEdit))))
.delete("/messages/:id",async c=>c.json(await removeMessage(storage(c),await me(c),id(c.req.param("id")),(await body(c,remove)).expectedRevision)))
.get("/me",async c=>c.json(await myDiscussions(storage(c),await me(c),parse(z.object({kind:z.enum(["topics","replies","subscriptions"]).optional(),cursor}).strict(),c.req.query()))))
.get("/notifications",async c=>c.json(await listNotifications(storage(c),await me(c),parse(z.object({unread:bool,cursor,kind:z.literal("author_update").optional()}).strict(),c.req.query()))))
.post("/notifications/read",async c=>c.json(await readNotifications(storage(c),await me(c),(await body(c,z.object({ids:z.array(uuid).min(1).max(20)}).strict())).ids)))
.post("/reports",async c=>c.json(await createReport(storage(c),await me(c),await body(c,report)),201))
.get("/me/reports",async c=>c.json(await listReports(storage(c),parse(z.object({cursor}).strict(),c.req.query()),await me(c))))
.get("/dash",async c=>{await admin(c);return c.json(await listModeration(storage(c),parse(z.object({kind:z.enum(["topic","message"]).optional(),scope:z.enum(["chart_comment","forum_reply","forum_topic"]).optional(),targetId:uuid.optional(),board:z.string().max(50).optional(),chart:publicId.optional(),state:z.enum(["visible","hidden","deleted","all"]).optional(),reported:bool,cursor}).strict(),c.req.query())));})
.get("/dash/reports",async c=>{await admin(c);return c.json(await listReports(storage(c),parse(z.object({status:z.enum(["open","resolved","all"]).optional(),cursor}).strict(),c.req.query())));})
.post("/dash/reports/:id/resolution",async c=>c.json(await resolveReport(storage(c),await admin(c,true),id(c.req.param("id")),await body(c,z.object({status:z.enum(["dismissed","actioned"]),note:text(500)}).strict()))))
.post("/dash/topics/:publicId/moderation",async c=>c.json(await moderate(storage(c),await admin(c,true),{topic:numberId(c.req.param("publicId"))},await body(c,moderation))))
.post("/dash/messages/:id/moderation",async c=>c.json(await moderate(storage(c),await admin(c,true),{message:id(c.req.param("id"))},await body(c,moderation.extend({action:z.literal("hide")}).strict()))))
.patch("/dash/boards/:id",async c=>c.json(await updateBoard(storage(c),await admin(c,true),c.req.param("id"),await body(c,z.object({expectedRevision:expected,name:text(100),description:text(500),order:z.number().int().min(0).max(100),readOnly:z.boolean(),reason:text(500)}).strict()))));
