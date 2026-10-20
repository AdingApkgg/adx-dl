import {chooseFiles} from "./browser-input.mjs";
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
 async function layout(page, label) {
  for(const width of [320,390,768,1280]) {await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`${label} fits ${width}`);}
  if(evidenceDirectory) {await page.emulateMedia({colorScheme:"light"});await page.waitForFunction(()=>!document.documentElement.classList.contains("dark"));await page.screenshot({path:join(evidenceDirectory,`social-${label}-desktop.png`),fullPage:true});const light=await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue("--background"));await page.emulateMedia({colorScheme:"dark",reducedMotion:"reduce"});await page.waitForFunction(()=>document.documentElement.classList.contains("dark"));await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));assert.notEqual(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue("--background")),light);await page.screenshot({path:join(evidenceDirectory,`social-${label}-dark.png`),fullPage:true});await page.emulateMedia({colorScheme:"light",reducedMotion:"no-preference"});await page.waitForFunction(()=>!document.documentElement.classList.contains("dark"));await page.setViewportSize({width:390,height:900});await page.screenshot({path:join(evidenceDirectory,`social-${label}-mobile.png`),fullPage:true});}
 }
 async function socialCurrent(page,path) {const nav=page.getByRole("navigation",{name:"关注与通知导航",exact:true});assert.equal(await nav.locator('[aria-current="page"]').count(),1);assert.equal(await nav.locator('[aria-current="page"]').getAttribute("href"),path);}

 async function publish(draft){
  await writer.getByRole("region",{name:"公开发布",exact:true}).getByRole("combobox",{name:/公开版本/}).selectOption(draft.currentVersionId);
  await writer.getByLabel("我确认此版本的原始 ZIP 及其中的全部文件适合公开分享。",{exact:true}).check();
  const saved=await mutate(writer,`/api/v1/me/charts/${draft.id}/publication`,"PUT",()=>writer.getByRole("button",{name:draft.publication?"确认更新公开内容":"确认发布",exact:true}).click());
  await writer.getByText(`当前公开：版本 ${saved.versions.find(v=>v.id===saved.publication.versionId).ordinal}`,{exact:true}).waitFor();
  return saved;
 }
 async function append(label){
  await writer.goto(url(`/me/charts/${chart.id}`));
  await chooseFiles(writer.getByLabel("选择 ADX / ZIP",{exact:true}),{name:"following-next.zip",mimeType:"application/zip",buffer:zip(label)});
  await writer.getByRole("button",{name:"保存私有草稿",exact:true}).waitFor({timeout:90000});
  const next=await mutate(writer,`/api/v1/me/charts/${chart.id}/versions`,"POST",()=>writer.getByRole("button",{name:"保存私有草稿",exact:true}).click());
  chart=await publish(next);
 }
 try {
  await step("following_private_relationship_and_default_off_alerts",async()=>{
   const guest=await anonymous.newPage();await guest.goto(url(`/u/${identity.publicId}`));
   const href=await guest.getByRole("link",{name:"关注作者",exact:true}).getAttribute("href");assert.ok(href.includes("/login?"));assert.ok((await guest.getByRole("link",{name:"关注作者",exact:true}).boundingBox()).height>=44);await guest.close();
   for(const path of ["/api/v1/me/following","/api/v1/me/following/feed",relation])assert.equal((await anonymous.request.get(url(path))).status(),401);
   await reader.goto(url(`/u/${identity.publicId}`));
   await reader.getByRole("region",{name:"作者资料",exact:true}).waitFor();assert.equal(await reader.locator('form[role="search"] [name="author"]').count(),0);assert.equal(await reader.getByRole("button",{name:"分享主页",exact:true}).count(),1);await layout(reader,"profile");

   assert.ok((await reader.getByRole("button",{name:"关注作者",exact:true}).boundingBox()).height>=44);
   const followed=await mutate(reader,relation,"PUT",()=>reader.getByRole("button",{name:"关注作者",exact:true}).click());assert.equal(followed.following,true);assert.equal(followed.notify,false);
   assert.equal((await get(owner,"/api/v1/me/following")).items.length,0);
   await writer.goto(url("/me/charts/new"));await chooseFiles(writer.getByLabel("选择 ADX / ZIP",{exact:true}),{name:"following.zip",mimeType:"application/zip",buffer:zip("Following browser release")});
   await writer.getByRole("button",{name:"保存私有草稿",exact:true}).waitFor({timeout:90000});
   const draft=await mutate(writer,"/api/v1/me/charts","POST",()=>writer.getByRole("button",{name:"保存私有草稿",exact:true}).click());chart=await publish(draft);
   await reader.goto(url("/me/feed"));await reader.getByRole("heading",{level:3,name:"Following browser release",exact:true}).waitFor();
   await socialCurrent(reader,"/me/feed");await reader.getByRole("heading",{level:2,name:/UTC/}).waitFor();await layout(reader,"feed");
   const feedRow=reader.locator(".community-social-feed-card").first(),rowBounds=await feedRow.boundingBox(),authorBounds=await feedRow.locator('a[href^="/u/"]').boundingBox();assert.ok(authorBounds.y+authorBounds.height<=rowBounds.y+rowBounds.height+1,"feed author fits inside its grid row");
   // Synthetic DOM clones exercise multi-row CSS without creating extra chart data.
   await reader.evaluate(()=>{const list=document.querySelector(".community-social-feed-card")?.parentElement;if(!list)return;for(let n=0;n<6;n++){const clone=list.firstElementChild.cloneNode(true);clone.setAttribute("data-layout-fixture","true");clone.querySelector("h3").textContent=n%2?"多行标题".repeat(15):"短标题";list.append(clone);}});
   for(const width of [320,390,768,1280]){await reader.setViewportSize({width,height:900});const bounds=await reader.locator(".community-social-feed-card").evaluateAll(rows=>rows.map(row=>{const box=row.getBoundingClientRect(),link=row.querySelector('a[href^="/u/"]')?.getBoundingClientRect();return {bottom:box.bottom,linkBottom:link?.bottom};}));assert.ok(bounds.length>=6);for(const row of bounds)assert.ok(row.linkBottom<=row.bottom+1,"multi-row author remains within grid cell");}
   await reader.evaluate(()=>document.querySelectorAll('[data-layout-fixture]').forEach(node=>{node.remove();}));
   const response=await other.request.get(url("/api/v1/me/following/feed"));assert.equal(response.headers()["cache-control"],"private, no-store");
   assert.equal((await get(other,"/api/v1/discussions/notifications?kind=author_update")).items.length,0);
  });
  await step("following_enable_new_version_notify_and_durable_read",async()=>{
   await reader.goto(url("/me/following"));
   await socialCurrent(reader,"/me/following");await layout(reader,"following");
   const enabled=await mutate(reader,relation,"PUT",()=>reader.getByRole("checkbox",{name:"接收站内更新提醒",exact:true}).click());assert.equal(enabled.notify,true);
   await reader.waitForFunction(()=>document.querySelector('input[type="checkbox"]')?.checked===true);
   assert.equal((await get(other,"/api/v1/discussions/notifications?kind=author_update")).items.length,0);
   await append("Following browser second version");
   const deadline=Date.now()+80000;
   for(;;){const n=await get(other,"/api/v1/discussions/notifications?kind=author_update");if(n.items.some(n=>n.update?.chart?.versionId===chart.currentVersionId))break;assert.ok(Date.now()<deadline,"actual following worker must deliver new version");await new Promise(r=>setTimeout(r,1000));}
   await reader.goto(url("/me/notifications?kind=author_update"));await reader.getByRole("heading",{level:3,name:/作者更新/}).waitFor();
   await socialCurrent(reader,"/me/notifications");
   await reader.getByRole("link",{name:"未读",exact:true}).click();await reader.waitForURL(u=>u.searchParams.get("unread")==="true"&&u.searchParams.get("kind")==="author_update");
   await reader.getByRole("combobox",{name:"通知内容",exact:true}).selectOption("");await reader.getByRole("button",{name:"应用",exact:true}).click();await reader.waitForURL(u=>u.searchParams.get("unread")==="true"&&!u.searchParams.get("kind"));
   await reader.getByRole("combobox",{name:"通知内容",exact:true}).selectOption("author_update");await reader.getByRole("button",{name:"应用",exact:true}).click();await reader.waitForURL(u=>u.searchParams.get("unread")==="true"&&u.searchParams.get("kind")==="author_update");await layout(reader,"notifications");
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
