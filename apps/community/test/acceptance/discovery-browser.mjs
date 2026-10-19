import assert from 'node:assert/strict';
import {join} from 'node:path';
import {enabled} from './browser-input.mjs';
/** Continues the author upload flow; all mutations stay in the disposable native fixture. */
export async function exerciseDiscovery({owner,other,anonymous,origin,step,evidenceDirectory}){
 const writer=await other.newPage(),reader=await owner.newPage(),errors=[];for(const p of [writer,reader])p.on('pageerror',e=>errors.push(e.name));const url=p=>new URL(p,origin).href;
 const get=async(context,path)=>{const r=await context.request.get(url(path));assert.equal(r.status(),200,path);return r.json();};
 let chart,alias='Discovery alias '+crypto.randomUUID(),listName='Discovery list '+crypto.randomUUID();
 try{
 await step('discovery_alias_draft_explicit_publication_and_current_version_identity',async()=>{
  const workbench=await get(other,'/api/v1/me/charts/workbench');const selected=workbench.items.find(c=>c.publication&&!c.moderated);assert.ok(selected);
  chart=await get(other,`/api/v1/me/charts/${selected.id}`);const original=chart.versions.find(v=>v.id===chart.publication.versionId);assert.ok(original);const before={number:chart.publicId,version:chart.publication.versionId,source:original.sourceFileId};
  await writer.goto(url(`/me/charts/${chart.id}`));await writer.getByLabel('别名',{exact:true}).fill(alias);
  const saved=writer.waitForResponse(r=>new URL(r.url()).pathname===`/api/v1/me/charts/${chart.id}`&&r.request().method()==='PATCH');await writer.getByRole('button',{name:'保存作品资料',exact:true}).click();assert.equal((await saved).status(),200);
  assert.equal((await get(anonymous,`/api/v1/search?type=charts&q=${encodeURIComponent(alias)}`)).groups.charts.total,0);
  const publication=writer.getByRole('region',{name:'公开发布',exact:true}),select=publication.getByRole('combobox',{name:/公开版本/});await enabled(select);await select.selectOption(before.version);await publication.getByLabel('我确认此版本的原始 ZIP 及其中的全部文件适合公开分享。',{exact:true}).check();
  const published=writer.waitForResponse(r=>new URL(r.url()).pathname===`/api/v1/me/charts/${chart.id}/publication`&&r.request().method()==='PUT');await publication.getByRole('button',{name:'确认更新公开内容',exact:true}).click();assert.equal((await published).status(),200);
  chart=await get(other,`/api/v1/me/charts/${chart.id}`);assert.equal(chart.publicId,before.number);assert.equal(chart.publication.versionId,before.version);assert.equal(chart.versions.find(v=>v.id===before.version).sourceFileId,before.source);
  const result=await get(anonymous,`/api/v1/search?type=charts&q=${encodeURIComponent(alias)}`);assert.equal(result.groups.charts.total,1);assert.equal(result.groups.charts.items[0].reason.kind,'alias');
 });
 await step('discovery_suggestions_same_slot_filters_share_and_library_actions',async()=>{
  await reader.goto(url('/search'));const main=reader.locator('main'),input=main.getByRole('combobox',{name:'搜索公开内容',exact:true});await input.fill(alias);await main.getByRole('listbox').getByRole('link').first().waitFor();await input.press('Escape');await input.press('Enter');await reader.waitForURL(u=>u.pathname==='/search'&&u.searchParams.get('q')===alias);
  await reader.goto(url(`/search?${new URLSearchParams({q:alias,type:'charts',difficulty:'4',preview:'1',minSeconds:'0',maxSeconds:'3600'})}`));await main.getByRole('link',{name:chart.publication.title,exact:true}).first().waitFor();
  const api=await get(anonymous,`/api/v1/search?${new URLSearchParams({q:alias,type:'charts',difficulty:'6',preview:'1'})}`);assert.equal(api.groups.charts.total,0);
  await reader.goto(url(`/charts/${chart.publicId}?difficulty=4&t=0.5`));const preview=reader.getByRole('region',{name:'公开谱面预览',exact:true});assert.equal(await preview.locator('canvas').count(),0);await preview.getByRole('button',{name:'加载预览',exact:true}).click();await enabled(preview.getByRole('button',{name:'播放',exact:true}));assert.equal(await preview.getByRole('button',{name:'暂停',exact:true}).count(),0);const seek=preview.getByRole('slider',{name:'拖动预览时间轴',exact:true});assert.ok(Number(await seek.inputValue())>=0.49);await preview.getByRole('button',{name:'分享当前难度与位置',exact:true}).waitFor();
  await reader.goto(url(`/search?${new URLSearchParams({q:alias,type:'charts'})}`));const clear=reader.getByRole('button',{name:'清除选择',exact:true});if(await clear.count())await clear.click();
  const checkbox=reader.locator('main').getByRole('checkbox').filter({visible:true});await checkbox.last().check();const bar=reader.locator('aside').filter({has:reader.getByRole('button',{name:'加入谱单',exact:true})});await bar.getByRole('button',{name:'加入谱单',exact:true}).click();await bar.getByLabel('谱单名称',{exact:true}).fill(listName);await bar.getByRole('button',{name:'加入 1 首',exact:true}).click();await bar.locator('a[href^="/me/lists/"]').waitFor();assert.equal((await get(owner,'/api/v1/me/lists')).items.some(l=>l.name===listName),true);await bar.getByRole('button',{name:'加入下载队列',exact:true}).waitFor();
  if(evidenceDirectory)await reader.screenshot({path:join(evidenceDirectory,'discovery-search-library.png'),fullPage:true});
 });
 await step('discovery_directories_languages_mobile_and_public_xml',async()=>{
  for(const prefix of ['','/en','/ja'])for(const path of ['/discover','/authors','/tags','/search?type=lists','/search?type=topics']){await reader.goto(url(prefix+path));await reader.locator('main h1').waitFor();for(const width of [320,390,1280]){await reader.setViewportSize({width,height:900});assert.equal(await reader.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}}
  for(const path of ['/sitemap.xml','/sitemaps/charts-0.xml','/feed.xml']){const r=await anonymous.request.get(url(path));assert.equal(r.status(),200);assert.match(r.headers()['cache-control'],/no-store/);assert.ok((await r.text()).includes(`/charts/${chart.publicId}`)||path==='/sitemap.xml');}
 });
 await step('discovery_withdrawal_removes_suggestions_results_counts_and_xml',async()=>{
  const r=await other.request.delete(url(`/api/v1/me/charts/${chart.id}/publication`),{headers:{origin:origin.origin},data:{expectedRevision:chart.revision}});assert.equal(r.status(),200);
  assert.equal((await get(anonymous,`/api/v1/search?type=charts&q=${encodeURIComponent(alias)}`)).groups.charts.total,0);
  assert.deepEqual(await get(anonymous,`/api/v1/search/suggestions?q=${encodeURIComponent(alias)}`),[]);
  for(const path of ['/sitemaps/charts-0.xml','/feed.xml'])assert.equal((await (await anonymous.request.get(url(path))).text()).includes(`/charts/${chart.publicId}<`),false);
  assert.equal(errors.length,0);
 });
 }finally{await writer.close();await reader.close();}
}
