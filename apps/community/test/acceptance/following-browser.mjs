import assert from "node:assert/strict";
import { join } from "node:path";
/** Real disposable accounts; relationship and publication writes use visible controls. */
export async function exerciseFollowing({owner,other,anonymous,origin,step,zip,evidenceDirectory}) {
 const writer=await owner.newPage(),reader=await other.newPage(),errors=[];
 for(const p of [writer,reader])p.on("pageerror",e=>errors.push(e.message));
 const url=p=>new URL(p,origin).href;
 async function get(context,path){const r=await context.request.get(url(path));assert.equal(r.status(),200,path);return r.json();}
 async function mutate(page,path,method,action){const [r]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===path&&r.request().method()===method,{timeout:60000}),action()]);assert.ok(r.ok(),`${method} ${path}: ${r.status()}`);return r.json();}
 const identity=await get(owner,"/api/v1/me"),relation=`/api/v1/me/following/authors/${identity.publicId}`;
 let chart;
 async function publish(draft){
  await writer.getByRole("region",{name:"公开发布",exact:true}).getByRole("combobox",{name:/公开版本/}).selectOption(draft.currentVersionId);
  await writer.getByLabel("我确认此版本的原始 ZIP 及其中的全部文件适合公开分享。",{exact:true}).check();
  const saved=await mutate(writer,`/api/v1/me/charts/${draft.id}/publication`,"PUT",()=>writer.getByRole("button",{name:draft.publication?"确认更新公开内容":"确认发布",exact:true}).click());
  await writer.getByText(`当前公开：版本 ${saved.versions.find(v=>v.id===saved.publication.versionId).ordinal}`,{exact:true}).waitFor();
  return saved;
 }
 async function append(label){
  await writer.goto(url(`/me/charts/${chart.id}`));
  await writer.getByLabel("选择 ADX / ZIP",{exact:true}).setInputFiles({name:"following-next.zip",mimeType:"application/zip",buffer:zip(label)});
  await writer.getByRole("button",{name:"保存私有草稿",exact:true}).waitFor({timeout:90000});
  const next=await mutate(writer,`/api/v1/me/charts/${chart.id}/versions`,"POST",()=>writer.getByRole("button",{name:"保存私有草稿",exact:true}).click());
  chart=await publish(next);
 }
 try {
  await step("following_private_relationship_and_default_off_alerts",async()=>{
   const guest=await anonymous.newPage();await guest.goto(url(`/u/${identity.publicId}`));
   const href=await guest.getByRole("link",{name:"关注作者",exact:true}).getAttribute("href");assert.ok(href.includes("/login?"));await guest.close();
   for(const path of ["/api/v1/me/following","/api/v1/me/following/feed",relation])assert.equal((await anonymous.request.get(url(path))).status(),401);
   await reader.goto(url(`/u/${identity.publicId}`));
   const followed=await mutate(reader,relation,"PUT",()=>reader.getByRole("button",{name:"关注作者",exact:true}).click());assert.equal(followed.following,true);assert.equal(followed.notify,false);
   assert.equal((await get(owner,"/api/v1/me/following")).items.length,0);
   await writer.goto(url("/me/charts/new"));await writer.getByLabel("选择 ADX / ZIP",{exact:true}).setInputFiles({name:"following.zip",mimeType:"application/zip",buffer:zip("Following browser release")});
   await writer.getByRole("button",{name:"保存私有草稿",exact:true}).waitFor({timeout:90000});
   const draft=await mutate(writer,"/api/v1/me/charts","POST",()=>writer.getByRole("button",{name:"保存私有草稿",exact:true}).click());chart=await publish(draft);
   await reader.goto(url("/me/feed"));await reader.getByRole("heading",{level:2,name:"Following browser release",exact:true}).waitFor();
   const response=await other.request.get(url("/api/v1/me/following/feed"));assert.equal(response.headers()["cache-control"],"private, no-store");
   assert.equal((await get(other,"/api/v1/discussions/notifications?kind=author_update")).items.length,0);
  });
  await step("following_enable_new_version_notify_and_durable_read",async()=>{
   await reader.goto(url("/me/following"));
   const enabled=await mutate(reader,relation,"PUT",()=>reader.getByRole("checkbox",{name:"接收站内更新提醒",exact:true}).click());assert.equal(enabled.notify,true);
   await reader.waitForFunction(()=>document.querySelector('input[type="checkbox"]')?.checked===true);
   assert.equal((await get(other,"/api/v1/discussions/notifications?kind=author_update")).items.length,0);
   await append("Following browser second version");
   const deadline=Date.now()+80000;
   for(;;){const n=await get(other,"/api/v1/discussions/notifications?kind=author_update");if(n.items.some(n=>n.update?.chart?.versionId===chart.currentVersionId))break;assert.ok(Date.now()<deadline,"actual following worker must deliver new version");await new Promise(r=>setTimeout(r,1000));}
   await reader.goto(url("/me/notifications?kind=author_update"));await reader.getByRole("heading",{level:3,name:/作者更新/}).waitFor();
   await mutate(reader,"/api/v1/discussions/notifications/read","POST",()=>reader.getByRole("button",{name:"本页未读标为已读",exact:true}).click());
   assert.equal((await get(other,"/api/v1/discussions/notifications?kind=author_update&unread=true")).items.length,0);
   if(evidenceDirectory)await reader.screenshot({path:join(evidenceDirectory,"following-notifications.png"),fullPage:true});
  });
  await step("following_metadata_only_and_unfollow_stop_future_delivery",async()=>{
   await writer.getByLabel("标题",{exact:true}).fill("Following metadata only");
   const edited=await mutate(writer,`/api/v1/me/charts/${chart.id}`,"PATCH",()=>writer.getByRole("button",{name:"保存作品资料",exact:true}).click());chart=await publish(edited);
   const feed=await get(other,"/api/v1/me/following/feed");assert.equal(feed.items.filter(e=>e.chart.id===chart.id).length,1);
   assert.equal((await get(other,"/api/v1/discussions/notifications?kind=author_update&unread=true")).items.length,0);
   await reader.goto(url("/me/following"));await mutate(reader,relation,"PUT",()=>reader.getByRole("button",{name:"取消关注",exact:true}).click());
   await reader.getByText("还没有关注的作者。从作者主页或谱面详情页开始关注。",{exact:true}).waitFor();
   await append("Following browser after unfollow");
   const deadline=Date.now()+80000;
   for(;;){const status=await get(owner,"/api/v1/dash/status");if(status.following.pendingEvents===0)break;assert.ok(Date.now()<deadline,"following outbox must drain");await new Promise(r=>setTimeout(r,1000));}
   assert.equal((await get(other,"/api/v1/me/following/feed")).items.length,0);
   assert.equal((await get(other,"/api/v1/discussions/notifications?kind=author_update&unread=true")).items.length,0);
   for(const width of [320,390]){await reader.setViewportSize({width,height:844});await reader.goto(url("/me/feed"));assert.equal(await reader.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);}
   if(evidenceDirectory)await reader.screenshot({path:join(evidenceDirectory,"following-feed-mobile.png"),fullPage:true});
  });
  assert.deepEqual(errors,[],"following browser uncaught errors");
 } finally {await writer.close();await reader.close();}
}
