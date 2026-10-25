import assert from "node:assert/strict";
import {enabled,chooseFiles} from "./browser-input.mjs";
import {join} from "node:path";
/** Complete author writes run only in the disposable synthetic acceptance project. */
export async function exerciseAuthor({owner,other,anonymous,origin,step,zip,evidenceDirectory}){
 const page=await other.newPage(),errors=[];page.on("pageerror",error=>errors.push(error.message));const url=path=>new URL(path,origin).href;
 const get=async(context,path,status=200)=>{const r=await context.request.get(url(path));assert.equal(r.status(),status,path);return r.json();};
 const row=name=>page.getByRole("listitem").filter({has:page.getByText(name,{exact:true})});
 const ready=()=>page.getByRole("status").filter({hasText:/^就绪待保存/});const saved=()=>page.getByRole("status").filter({hasText:/^已保存/});
 const uploadButton=()=>page.getByRole("button",{name:"确认计划并上传",exact:true});
 let lost=false,firstChart,updated,extraContext;
 const a=zip("Creator first"),b=zip("Creator second"),next=zip("Creator next version",true),partsText=`&title=Creator parts ${crypto.randomUUID()}\n&inote_4=(120){4}1,3,E\n`;
 try{
 await step("author_executor_reload_handoff_and_cross_tab_exclusion",async()=>{
  await page.goto(url("/me/imports"));const picker=page.getByLabel("添加 ADX / ZIP（可多选）",{exact:true});await picker.waitFor();
  const lease=async(webLock,expired=false)=>page.evaluate(async({webLock,expired})=>{const db=await new Promise((resolve,reject)=>{const request=indexedDB.open("adxc-imports-v1",1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});await new Promise((resolve,reject)=>{const tx=db.transaction("meta","readwrite");tx.objectStore("meta").put({id:"executor",owner:"abandoned-fixture",token:"fixture-token",until:Date.now()+(expired?-1:15000),...(webLock?{webLock:true}:{})});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();},{webLock,expired});
  const probe=name=>chooseFiles(picker,{name,mimeType:"application/zip",buffer:a});
  const remove=async name=>{await row(name).getByRole("button",{name:"从计划移除",exact:true}).click();await row(name).waitFor({state:"detached"});await enabled(picker);};
  await lease(true);await probe("reload-probe.zip");await remove("reload-probe.zip");
  const lockPage=await other.newPage();try{
   await lockPage.goto(url("/me/imports"));await lockPage.evaluate(()=>{window.__authorHeld=false;void navigator.locks.request("adxc-import-executor",()=>{window.__authorHeld=true;return new Promise(resolve=>{window.__releaseAuthorLock=resolve;});});});await lockPage.waitForFunction(()=>window.__authorHeld);
   await probe("locked-probe.zip");await page.getByText("EXECUTOR_BUSY",{exact:true}).waitFor();assert.equal(await row("locked-probe.zip").count(),0);
   await lockPage.evaluate(()=>window.__releaseAuthorLock());
  }finally{await lockPage.close();}
  await lease(false);await probe("leased-probe.zip");await page.getByText("EXECUTOR_BUSY",{exact:true}).waitFor();assert.equal(await row("leased-probe.zip").count(),0);
  await lease(false,true);await probe("expired-probe.zip");await remove("expired-probe.zip");
 });
 await step("author_batch_three_inputs_refresh_and_ambiguous_save",async()=>{
  await page.goto(url("/me/imports"));await page.getByRole("heading",{level:1,name:"批量导入",exact:true}).waitFor();
  let writes=0;page.on("request",request=>{if(["POST","PATCH","PUT","DELETE"].includes(request.method())&&!new URL(request.url()).pathname.startsWith("/_s/"))writes++;});
  await chooseFiles(page.getByLabel("添加 ADX / ZIP（可多选）",{exact:true}),[{name:"creator-a.zip",mimeType:"application/zip",buffer:a},{name:"creator-b.adx",mimeType:"application/zip",buffer:b}]);
  await page.getByLabel("谱面文件（必选）",{exact:true}).setInputFiles({name:"creator-parts.txt",mimeType:"text/plain",buffer:Buffer.from(partsText)});
  await page.getByRole("button",{name:"添加这组零散文件",exact:true}).click();await row("creator-parts.txt").waitFor();assert.equal(writes,0,"plan editing is local");
  let partsUpload=null,interruptParts=true;
  await page.route("**/api/v1/uploads",async route=>{if(route.request().method()!=="POST"||JSON.parse(route.request().postData()??"{}").name!=="chart.zip")return route.continue();const response=await route.fetch();partsUpload=(await response.json()).id;await route.fulfill({response});});
  await page.route("**/api/v1/uploads/*/parts/*",route=>{if(interruptParts&&partsUpload&&new URL(route.request().url()).pathname.includes(`/uploads/${partsUpload}/`))return route.abort("failed");return route.continue();});
  await uploadButton().click();await ready().nth(1).waitFor({timeout:120000});await row("creator-parts.txt").getByRole("status").filter({hasText:/^失败/}).waitFor();assert.equal(await saved().count(),0);interruptParts=false;
  const before=writes;await page.reload();await page.getByRole("heading",{level:1,name:"批量导入",exact:true}).waitFor();assert.equal(writes,before,"refresh must not automatically reserve uploads or save");
  await page.getByRole("button",{name:"核对服务器结果",exact:true}).click();await ready().nth(1).waitFor({timeout:30000});
  await row("creator-parts.txt").getByLabel("谱面文件（必选）",{exact:true}).setInputFiles({name:"creator-parts.txt",mimeType:"text/plain",buffer:Buffer.from(partsText)});
  await row("creator-parts.txt").getByRole("button",{name:"组装并续传",exact:true}).click();await uploadButton().click();await ready().nth(2).waitFor({timeout:90000});
  await page.route("**/api/v1/me/charts",async route=>{if(route.request().method()!=="POST"||lost)return route.continue();lost=true;const response=await route.fetch();assert.equal(response.status(),201);firstChart=await response.json();await route.abort("failed");});
  for(const name of ["creator-a.zip","creator-b.adx","creator-parts.txt"])await row(name).getByRole("checkbox").check();
  await page.getByRole("button",{name:"保存所选就绪项为私人草稿 / 版本",exact:true}).click();await saved().nth(1).waitFor({timeout:60000});await page.getByRole("status").filter({hasText:/^结果待确认/}).waitFor();
  await page.getByRole("button",{name:"核对服务器结果",exact:true}).click();await saved().nth(2).waitFor({timeout:30000});
  assert.ok(firstChart);assert.equal((await get(other,"/api/v1/me/charts/workbench")).targets.filter(t=>t.id===firstChart.id).length,1);
  await get(owner,`/api/v1/me/charts/${firstChart.id}`,404);await get(anonymous,`/api/v1/me/charts/${firstChart.id}`,401);assert.equal(firstChart.publication,null);
 });
 await step("author_duplicate_mapping_conflict_and_explicit_append",async()=>{
  await chooseFiles(page.getByLabel("添加 ADX / ZIP（可多选）",{exact:true}),Array.from({length:11},(_,i)=>({name:`limit-${i}.zip`,mimeType:"application/zip",buffer:a})));await page.getByText("BATCH_LIMIT",{exact:true}).waitFor();assert.equal(await saved().count(),3);
  await chooseFiles(page.getByLabel("添加 ADX / ZIP（可多选）",{exact:true}),[{name:"append-a.zip",mimeType:"application/zip",buffer:next},{name:"append-duplicate.zip",mimeType:"application/zip",buffer:next}]);await row("append-duplicate.zip").waitFor();
  await uploadButton().click();await page.getByText("DUPLICATE_BYTES",{exact:true}).first().waitFor();
  await row("append-duplicate.zip").getByRole("button",{name:"从计划移除",exact:true}).click();await row("append-a.zip").getByRole("combobox").selectOption(firstChart.id);
  const changed=await other.request.patch(url(`/api/v1/me/charts/${firstChart.id}`),{headers:{origin:origin.origin},data:{expectedRevision:firstChart.revision,title:"Creator concurrent edit"}});assert.equal(changed.status(),200);
  await uploadButton().click();await row("append-a.zip").getByText("CHART_CHANGED",{exact:true}).waitFor();
  await row("append-a.zip").getByRole("button",{name:"读取最新修订并重新确认目标",exact:true}).click();await uploadButton().click();await ready().first().waitFor({timeout:90000});await row("append-a.zip").getByRole("checkbox").check();await page.getByRole("button",{name:"保存所选就绪项为私人草稿 / 版本",exact:true}).click();await saved().first().waitFor({timeout:60000});
  updated=await get(other,`/api/v1/me/charts/${firstChart.id}`);assert.equal(updated.versions.length,2);assert.notEqual(updated.currentVersionId,firstChart.currentVersionId);assert.equal(updated.publication,null);
 });
 await step("author_source_review_comparison_notes_and_deliberate_publication",async()=>{
  await page.goto(url(`/me/charts/${firstChart.id}/review?version=${firstChart.currentVersionId}`));await page.getByRole("heading",{level:2,name:"只读 Simai 源码",exact:true}).waitFor({timeout:30000});assert.equal((await get(other,`/api/v1/me/charts/${firstChart.id}`)).currentVersionId,updated.currentVersionId);
  const seek=page.getByRole("button",{name:/1:|2:|3:/}).filter({hasText:/2\.000s/}).first();await seek.click();await page.locator("canvas").waitFor();await enabled(page.getByRole("button",{name:"播放",exact:true}));await page.getByRole("region",{name:"私有预览",exact:true}).getByText(/^0:02 \/ /).waitFor();assert.equal(await page.getByRole("button",{name:"暂停",exact:true}).count(),0);assert.equal(await page.locator("canvas").count(),1);
  await page.goto(url(`/me/charts/${firstChart.id}/compare?left=${firstChart.currentVersionId}&right=${updated.currentVersionId}&difficulty=4`));await page.getByRole("heading",{level:2,name:"只读 Simai 源码",exact:true}).nth(1).waitFor({timeout:30000});await page.getByText("已完成有界语句对照",{exact:true}).waitFor();
  await page.getByRole("button",{name:"生成本地更新说明草稿",exact:true}).click();const note=page.getByRole("textbox",{name:"所选版本更新说明",exact:true});assert.ok((await note.inputValue()).length>0);assert.equal((await get(other,`/api/v1/me/charts/${firstChart.id}`)).versions[0].releaseNote,"");
  const noteSaved=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/v1/me/charts/${firstChart.id}`&&r.request().method()==="PATCH");await page.getByRole("button",{name:"保存更新说明",exact:true}).click();assert.equal((await noteSaved).status(),200);updated=await get(other,`/api/v1/me/charts/${firstChart.id}`);assert.ok(updated.versions[0].releaseNote.length>0);assert.equal(updated.publication,null);
  for(const width of [320,390]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}await page.setViewportSize({width:1280,height:900});
  await page.goto(url(`/me/charts/${firstChart.id}`));const publication=page.getByRole("region",{name:"公开发布",exact:true});const selector=publication.getByRole("combobox",{name:/公开版本/});await enabled(selector);await selector.selectOption(updated.currentVersionId);await publication.getByLabel("我确认此版本的原始 ZIP 及其中的全部文件适合公开分享。",{exact:true}).check();
  const response=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/v1/me/charts/${firstChart.id}/publication`&&r.request().method()==="PUT");await publication.getByRole("button",{name:"确认发布",exact:true}).click();const published=await response;assert.equal(published.status(),200);updated=await published.json();assert.match(updated.publicId,/^[1-9][0-9]*$/);assert.equal((await get(anonymous,`/api/v1/charts/${updated.publicId}`)).versionId,updated.currentVersionId);
  if(evidenceDirectory)await page.screenshot({path:join(evidenceDirectory,"author-publication.png"),fullPage:true});
 });
 await step("author_scope_isolation_and_three_language_workspace",async()=>{
  extraContext=await other.browser().newContext();await extraContext.addCookies(await other.cookies());const switched=await extraContext.newPage();await switched.goto(url("/me/imports"));await chooseFiles(switched.getByLabel("添加 ADX / ZIP（可多选）",{exact:true}),{name:"scope-only.zip",mimeType:"application/zip",buffer:a});await switched.getByText("scope-only.zip",{exact:true}).waitFor();await extraContext.clearCookies();await extraContext.addCookies(await owner.cookies());await switched.reload();assert.equal(await switched.getByText("scope-only.zip",{exact:true}).count(),0);await extraContext.close();extraContext=null;
  for(const prefix of ["","/en","/ja"])for(const path of ["/me/workbench","/me/imports",`/me/charts/${firstChart.id}/review`,`/me/charts/${firstChart.id}/compare`]){await page.goto(url(prefix+path));await page.locator("main h1").waitFor();await page.waitForLoadState("networkidle");for(const width of [320,390,1280]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${prefix}${path} at ${width}px`);}}
  assert.equal(errors.length,0,"author journey runtime errors");
 });
 await step("author_confirmation_recovery_focus_and_sidebar",async()=>{
  await page.goto(url(`/me/charts/${firstChart.id}`));
  const publication=page.getByRole("region",{name:"公开发布",exact:true}),selector=publication.getByRole("combobox",{name:/公开版本/});await enabled(selector);await selector.selectOption(updated.currentVersionId);
  for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,"PUBLISHED_SELECTED_SIDEBAR_NO_OVERFLOW");}
  if(evidenceDirectory)await page.screenshot({path:join(evidenceDirectory,"author-sidebar-snapshots.png"),fullPage:true});
  const pattern=`**/api/v1/me/charts/${firstChart.id}/publication`;let withdrawals=0;
  const reject=async route=>{if(route.request().method()==="DELETE"){withdrawals++;await route.fulfill({status:409,contentType:"application/json",body:JSON.stringify({error:{code:"CHART_CHANGED",message:"Synthetic conflict"}})});}else await route.fallback();};
  await page.route(pattern,reject);
  try{
   const trigger=publication.getByRole("button",{name:"撤回公开",exact:true});await trigger.click();const modal=page.getByRole("alertdialog",{name:"撤回公开",exact:true});
   await modal.getByRole("button",{name:"确认撤回",exact:true}).click();await modal.getByRole("alert").waitFor();assert.equal(await modal.getByRole("alert").isVisible(),true,"MODAL_FAILURE_IS_ACCESSIBLE");
   await modal.getByRole("button",{name:"取消",exact:true}).click();await modal.waitFor({state:"hidden"});assert.equal(withdrawals,1,"WITHDRAWAL_NOT_REPLAYED");assert.equal(await trigger.evaluate(el=>el===document.activeElement),true,"CANCEL_RESTORES_TRIGGER_FOCUS");
  }finally{await page.unroute(pattern,reject);}
  await page.reload();const versions=page.getByRole("region",{name:"历史版本",exact:true});await versions.waitFor();const oldVersion=versions.getByRole("button",{name:"删除版本",exact:true}).first();await oldVersion.click();
  const modal=page.getByRole("alertdialog");await modal.getByRole("button",{name:"删除草稿",exact:true}).click();await modal.waitFor({state:"hidden"});await page.waitForFunction(()=>document.activeElement?.id==="author-versions");
  assert.equal((await get(other,`/api/v1/me/charts/${firstChart.id}`)).versions.length,1,"EXPLICIT_VERSION_DELETION_SUCCEEDED");assert.equal(errors.length,0,"author confirmation runtime errors");
 });
 }catch(error){if(evidenceDirectory)await page.screenshot({path:join(evidenceDirectory,"author-failure.png"),fullPage:true,timeout:5000}).catch(()=>{});throw error;}
 finally{await page.close();await extraContext?.close();}
}
