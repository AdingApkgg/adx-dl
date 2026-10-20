import assert from "node:assert/strict";
import {join} from "node:path";
export async function exerciseUiLayout({owner,anonymous,origin,step,evidenceDirectory}){
 const visitor=await anonymous.newPage(),member=await owner.newPage(),errors=[];
 for(const p of [visitor,member])p.on("pageerror",e=>errors.push(e.message));
 const url=path=>new URL(path,origin).href;
 const visit=async(p,path)=>{const r=await p.goto(url(path));assert.equal(r.status(),200,path);await p.locator("main h1").first().waitFor();};
 const settle=async(p)=>p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 async function geometry(p,width){
  await settle(p);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`no horizontal overflow at ${width}`);
  const nav=p.locator(".community-bottom-nav");assert.equal(await nav.isVisible(),width<1024);
  if(width<1024){assert.equal(await nav.getByRole("link").count(),4);for(const a of await nav.getByRole("link").all()){const box=await a.boundingBox();assert.ok(box.height>=44&&box.width>=44,"mobile touch targets");}}
 }
 try{
 await step("ui_public_breakpoints_and_single_search",async()=>{
  for(const path of ["/","/charts","/forum"]){await visit(visitor,path);for(const width of [320,390,768,1024,1280]){await visitor.setViewportSize({width,height:900});await geometry(visitor,width);}}
  for(const prefix of ["/en","/ja"]){await visit(visitor,prefix+"/");for(const width of [320,1280]){await visitor.setViewportSize({width,height:900});await geometry(visitor,width);}}
  await visit(visitor,"/");assert.equal(await visitor.getByRole("search").count(),1,"homepage has one search");assert.equal(await visitor.locator("main h1").count(),1);
  if(evidenceDirectory)await visitor.screenshot({path:join(evidenceDirectory,"ui-home-desktop.png"),fullPage:true});
 });
 await step("ui_mobile_languages_settings_and_focus",async()=>{
  await visitor.setViewportSize({width:320,height:900});await visit(visitor,"/en/charts?sort=title");const more=visitor.getByRole("button",{name:"More navigation",exact:true});await more.click();
  const current=visitor.getByRole("dialog",{name:"AstroDX Community",exact:true});await current.waitFor();
  const ja=current.getByRole("link",{name:"日本語",exact:true});assert.equal(await ja.getAttribute("href"),"/ja/charts?sort=title");await ja.click();await visitor.waitForURL(u=>u.pathname==="/ja/charts"&&u.searchParams.get("sort")==="title");
  await visit(visitor,"/en/charts?sort=title");await more.click();await current.getByRole("button",{name:"Open settings",exact:true}).click();
  const settings=visitor.getByRole("dialog",{name:"Settings",exact:true});await settings.waitFor();await settings.getByRole("button",{name:"Close settings",exact:true}).click();await settings.waitFor({state:"hidden"});await visitor.keyboard.press("Escape");await current.waitFor({state:"hidden"});assert.equal(await more.evaluate(e=>e===document.activeElement),true,"focus returns to More trigger");
  await geometry(visitor,320);if(evidenceDirectory)await visitor.screenshot({path:join(evidenceDirectory,"ui-mobile-navigation.png"),fullPage:true});
 });
 await step("ui_workspace_batch_toolbar_and_download_dock",async()=>{
  for(const path of ["/me/library","/me/workbench","/dash"]){await visit(member,path);for(const width of [390,1280]){await member.setViewportSize({width,height:900});await geometry(member,width);}}
  await visit(member,"/charts");await member.getByRole("checkbox",{name:/选择谱面 #/}).first().check();
  const bar=member.locator(".community-selection-bar");await bar.waitFor();await member.evaluate(()=>scrollTo(0,500));await settle(member);
  const toolbar=await bar.boundingBox(),header=await member.locator(".community-header").boundingBox();assert.ok(toolbar.y>=header.y+header.height,"batch toolbar below header");await bar.getByRole("button",{name:"加入下载队列",exact:true}).click({trial:true});await bar.getByRole("button",{name:"清空选择",exact:true}).click();
  const response=await owner.request.get(url("/api/v1/charts")),charts=await response.json();assert.ok(charts.items.length,"synthetic published chart for UI queue");
  await visit(member,`/charts/${charts.items[0].publicId}`);await member.getByRole("button",{name:"加入下载队列",exact:true}).click();await member.getByRole("button",{name:"确认加入并开始",exact:true}).click();
  await member.setViewportSize({width:390,height:900});const dock=member.locator(".community-download-dock");await dock.waitFor();await settle(member);
  const d=await dock.boundingBox(),n=await member.locator(".community-bottom-nav").boundingBox();assert.ok(d.y+d.height<=n.y,"queue stays above mobile navigation");await geometry(member,390);
  if(evidenceDirectory)await member.screenshot({path:join(evidenceDirectory,"ui-download-dock-mobile.png"),fullPage:true});
  await visit(member,"/downloads");await member.getByRole("button",{name:"清空本机任务与历史",exact:true}).click();
 });
 assert.deepEqual(errors,[]);
 }catch(e){if(evidenceDirectory)await Promise.allSettled([visitor.screenshot({path:join(evidenceDirectory,"ui-visitor-failure.png"),fullPage:true}),member.screenshot({path:join(evidenceDirectory,"ui-member-failure.png"),fullPage:true})]);throw e;}
 finally{await Promise.allSettled([visitor.close(),member.close()]);}
}
