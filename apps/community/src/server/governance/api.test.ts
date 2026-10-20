import { beforeAll, afterAll, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { sql, eq, inArray } from "drizzle-orm";
import { createApp } from "../app";
import { session,user,userPublicIds } from "../db/schema";
import { testAppDeps } from "../testing/app-deps";
import { TEST_AUTH_SECRET } from "../testing/constants";
import { resetTestDatabase } from "../testing/test-db";
import { exportTestUserIds } from "../testing/user-public-ids";
import { readyContext } from "../../../test/storage/ready-file";
import { cleanupStorageFixture } from "../../../test/storage/fixture";
let f:Awaited<ReturnType<typeof readyContext>>;const owners:string[]=[];
beforeAll(async()=>{await resetTestDatabase();f=await readyContext();});
afterAll(async()=>{if(f)await cleanupStorageFixture(f.ctx.db,owners,[f.policy.id]);});
async function account(){const id=crypto.randomUUID(),token=crypto.randomUUID();owners.push(id);await f.ctx.db.insert(user).values({id,name:'Governance account',email:`${id}@private.invalid`});await f.ctx.db.insert(session).values({userId:id,token,expiresAt:new Date(Date.now()+86400000)});const [n]=await f.ctx.db.select().from(userPublicIds).where(eq(userPublicIds.userId,id));return {id,publicId:n.publicId.toString(),headers:{authorization:`Bearer ${token}.${createHmac('sha256',TEST_AUTH_SECRET).update(token).digest('base64')}`}};}
test('governance APIs enforce active owner/admin, private caching and recent staff login',async()=>{
 const admin=await account(),regular=await account();await exportTestUserIds();const {deps}=testAppDeps();const app=createApp({...deps,services:{...deps.services,storage:f.ctx,adminPublicIds:[admin.publicId]}});
 for(const path of ['/api/v1/governance/me/decisions','/api/v1/governance/me/appeals','/api/v1/governance/dash/overview','/api/v1/governance/dash/tickets','/api/v1/governance/dash/appeals','/api/v1/governance/dash/audit']){
  const anonymous=await app.request(path);expect(anonymous.status).toBe(401);expect(anonymous.headers.get('cache-control')).toContain('no-store');
  const ordinary=await app.request(path,{headers:regular.headers});expect(ordinary.status).toBe(path.includes('/dash/')?403:200);
  expect((await app.request(path,{headers:admin.headers})).status).toBe(200);
 }
 expect((await app.request('/api/v1/governance/dash/tickets?source=private',{headers:admin.headers})).status).toBe(400);
 const before=await app.request('/api/v1/governance/dash/audit',{headers:admin.headers});expect((await before.json()).items).toEqual([]);
 await f.ctx.db.update(session).set({createdAt:new Date(Date.now()-86400000)}).where(eq(session.userId,admin.id));
 const reauth=await app.request(`/api/v1/governance/dash/appeals/${crypto.randomUUID()}/resolution`,{method:'POST',headers:{...admin.headers,'content-type':'application/json'},body:JSON.stringify({expectedRevision:1,status:'upheld',note:'Reviewed'})});expect(reauth.status).toBe(403);expect((await reauth.json()).error.code).toBe('REAUTH_REQUIRED');
 await f.ctx.db.update(user).set({status:'pending_deletion'}).where(inArray(user.id,[admin.id,regular.id]));
 for(const a of [admin,regular])expect((await app.request('/api/v1/governance/me/decisions',{headers:a.headers})).status).toBe(403);
});
