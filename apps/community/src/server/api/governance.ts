import { Hono, type Context } from "hono";
import { validator } from "hono/validator";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { appealInputSchema, appealResolutionSchema, governanceQuerySchema } from "@/shared/governance";
import type { AppEnv } from "../app-env";
import { currentAuth } from "../auth/mount";
import { isRecentLogin } from "../auth/recent-login";
import { dashAccess } from "../services/dash";
import { requireActiveSocialUser } from "../services/social-page";
import { StorageError, StorageUnavailableError } from "../storage/errors";
import { governanceOverview, governanceTickets, governanceAudit } from "../governance/core";
import { governanceDecisions, listAppeals, createAppeal, resolveAppeal } from "../governance/appeals";
const uuid=z.string().uuid().transform(v=>v.toLowerCase());
function parse<T>(schema:z.ZodType<T>,v:unknown):T{const r=schema.safeParse(v);if(!r.success)throw new HTTPException(400,{message:"Invalid governance request"});return r.data;}
function storage(c:Context<AppEnv>){const s=c.get('services').storage;if(!s)throw new StorageUnavailableError();return s;}
async function me(c:Context<AppEnv>){const a=currentAuth(c);await requireActiveSocialUser(c.get('services').db,a.user.id);return a.user.id;}
async function staff(c:Context<AppEnv>,write=false){const a=currentAuth(c);if(!await dashAccess(c.get('services'),a.user.id))throw new HTTPException(403);if(write&&!isRecentLogin(a.session.createdAt))throw new StorageError(403,'REAUTH_REQUIRED');return me(c);}
const ownQuery=governanceQuerySchema.pick({cursor:true}).strict(),appealsQuery=governanceQuerySchema.pick({cursor:true,status:true}).strict();
export const governanceRoutes=new Hono<AppEnv>()
 .use(async(c,next)=>{c.header('cache-control','private, no-store');c.header('x-robots-tag','noindex, nofollow');await next();})
 .get('/me/decisions',async c=>c.json(await governanceDecisions(storage(c),await me(c),parse(ownQuery,c.req.query()))))
 .get('/me/appeals',async c=>c.json(await listAppeals(storage(c),parse(appealsQuery,c.req.query()),await me(c))))
 .post('/me/appeals',validator('json',v=>parse(appealInputSchema,v)),async c=>c.json(await createAppeal(storage(c),await me(c),c.req.valid('json'))))
 .get('/dash/overview',async c=>{await staff(c);return c.json(await governanceOverview(storage(c)));})
 .get('/dash/tickets',async c=>{await staff(c);return c.json(await governanceTickets(storage(c),parse(governanceQuerySchema.omit({kind:true}).strict(),c.req.query())));})
 .get('/dash/audit',async c=>{await staff(c);return c.json(await governanceAudit(storage(c),parse(governanceQuerySchema.pick({cursor:true,kind:true}).strict(),c.req.query())));})
 .get('/dash/appeals',async c=>{await staff(c);return c.json(await listAppeals(storage(c),parse(appealsQuery,c.req.query())));})
 .post('/dash/appeals/:id/resolution',validator('json',v=>parse(appealResolutionSchema,v)),async c=>c.json(await resolveAppeal(storage(c),await staff(c,true),parse(uuid,c.req.param('id')),c.req.valid('json'))));
