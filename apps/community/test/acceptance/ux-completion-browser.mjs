import assert from "node:assert/strict";

export async function exerciseUxCompletion({page,origin,authenticated=false,onVisit=()=>{}}){
 const visit=async path=>{onVisit(path);const r=await page.goto(new URL(path,origin).href,{waitUntil:"domcontentloaded"});assert.equal(r.status(),200,path);await page.locator("main h1").first().waitFor();};
 await page.setViewportSize({width:1280,height:900});await visit("/en/charts");
 const pattern="**/en/forum.data*";
 let release;const held=new Promise(resolve=>{release=resolve;});
 const hold=async route=>{await held;await route.fallback();};
 await page.route(pattern,hold);
 let clicked;
 try{
  await page.locator('[data-community-motion="route"]').evaluate(el=>{window.__uxCompletionRoute=el;});
  const requested=page.waitForRequest(r=>new URL(r.url()).pathname==="/en/forum.data",{timeout:15000});
  onVisit("/en/forum");clicked=page.locator('.community-primary-link[href="/en/forum"]').click();
  // Attach a handler immediately; a failed click still fails below after releasing the held request.
  void clicked.catch(()=>{});
  await requested;
  await page.getByRole("progressbar",{name:"Opening page…",exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__uxCompletionRoute===document.querySelector('[data-community-motion="route"]')&&window.__uxCompletionRoute.isConnected),true,"LOADING_RETAINS_REAL_ROUTE");
  release();await clicked;await page.waitForURL(u=>u.pathname==="/en/forum");await page.locator(".community-forum-page").waitFor();
  await page.getByRole("progressbar",{name:"Opening page…",exact:true}).waitFor({state:"hidden"});
  await page.waitForFunction(()=>document.activeElement?.id==="main-content");
  assert.equal(await page.evaluate(()=>window.__uxCompletionRoute===document.querySelector('[data-community-motion="route"]')),true,"NAVIGATION_RETAINS_ROUTE_INSTANCE");
 }finally{
  release();if(clicked)await clicked.catch(()=>{});await page.unroute(pattern,hold);await page.evaluate(()=>{delete window.__uxCompletionRoute;}).catch(()=>{});
 }
 for(const width of [320,390,768,1280]){
  await page.setViewportSize({width,height:900});await visit("/en/help/upload");
  const help=page.getByRole("navigation",{name:"Help topics",exact:true});assert.equal(await help.locator('[aria-current="page"]').getAttribute("href"),"/en/help/upload");
  assert.equal(await page.locator(".community-help-page").isVisible(),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,"HELP_PAGE_NO_OVERFLOW");
  await visit("/en/privacy");
  const valid=await page.locator(".community-policy-page nav a").evaluateAll(links=>links.length>=6&&links.every(a=>document.getElementById(a.hash.slice(1))));assert.equal(valid,true,"PRIVACY_LINKS_HAVE_SECTIONS");
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,"PRIVACY_PAGE_NO_OVERFLOW");
 }
 await page.setViewportSize({width:1280,height:900});onVisit("/en/charts/9223372036854775807");
 const missing=await page.goto(new URL("/en/charts/9223372036854775807",origin).href);assert.equal(missing.status(),404);await page.locator(".community-recovery h1").waitFor();
 await page.locator('.community-recovery a[href="/en/charts"]').click();await page.waitForURL(u=>u.pathname==="/en/charts");
 const field=page.locator('form[role="search"] input[name="q"]').first();await field.fill("Unsaved search input");await field.focus();await page.evaluate(()=>{location.hash="ux-focus";});
 assert.equal(await field.inputValue(),"Unsaved search input");assert.equal(await field.evaluate(el=>el===document.activeElement),true,"HASH_PRESERVES_SEARCH_FOCUS");
 await field.fill("");
 if(authenticated){
  for(const path of ["/en/me/governance","/en/me/governance?view=appeals","/en/me/reports","/en/me/discussions?kind=reports"]){
   await visit(path);await page.locator(".community-record-page").waitFor();
   const nav=page.locator("main .community-content-nav").first();assert.equal(await nav.locator('[aria-current="page"]').count(),1,"RECORD_VIEW_HAS_ONE_ACTIVE_ITEM");
   await page.setViewportSize({width:320,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,"RECORD_PAGE_NO_OVERFLOW");await page.setViewportSize({width:1280,height:900});
  }
 }
 for(const prefix of ["", "/ja"]){await visit(prefix+"/help/upload");await page.locator('.community-help-topics [aria-current="page"]').waitFor();}
}
