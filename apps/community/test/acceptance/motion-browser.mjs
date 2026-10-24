import assert from "node:assert/strict";

// 嵌入现有 UI 验收组：只改当前浏览器的外观偏好及未提交输入，不写业务数据。
export async function exerciseMotion({page,origin,authenticated=false}){
 const url=path=>new URL(path,origin).href;
 const visit=async path=>{const response=await page.goto(url(path));assert.equal(response.status(),200,path);await page.locator("main h1").first().waitFor();};
 await page.setViewportSize({width:1280,height:900});await visit("/en/charts");
 const stored=await page.evaluate(()=>localStorage.getItem("adx-reduce-motion"));
 const originalMode=stored==="on"?"on":stored==="off"||stored==="1"?"off":"system";
 const labels={on:/^Motion on/,off:/^Reduce motion/,system:/^Follow system/};
 async function choose(mode){
  await page.getByRole("button",{name:"Open settings",exact:true}).filter({visible:true}).click();
  const settings=page.getByRole("dialog",{name:"Settings",exact:true});await settings.waitFor();
  // “Follow system”也出现在主题设置里，用动画组选项的独有说明限定。
  const button=mode==="system"?settings.getByRole("button",{name:/^Follow system Follow your device/}):settings.getByRole("button",{name:labels[mode]});
  await button.click();await page.waitForFunction(value=>document.documentElement.dataset.motion===value,mode);
  assert.equal(await button.getAttribute("aria-pressed"),"true");
  await settings.getByRole("button",{name:"Close settings",exact:true}).click();await settings.waitFor({state:"hidden"});
 }
 try{
  await page.emulateMedia({reducedMotion:"reduce"});await choose("system");
  const card=page.locator(".community-chart-card").first();await card.waitFor();await card.hover();
  assert.equal(await card.evaluate(el=>getComputedStyle(el).translate),"none","SYSTEM_REDUCED_MOTION_HOVER_STATIC");
  await choose("on");await card.hover();
  await page.waitForFunction(()=>{const card=document.querySelector(".community-chart-card");return card&&parseFloat(getComputedStyle(card).translate.split(/\s+/)[1])< -1.8;});
  await choose("off");await card.hover();
  assert.equal(await card.evaluate(el=>getComputedStyle(el).translate),"none","EXPLICIT_OFF_HOVER_STATIC");
  await page.evaluate(()=>{window.__motionRoute=document.querySelector('[data-community-motion="route"]');});
  await page.locator('.community-primary-link[href="/en/forum"]').click();await page.waitForURL(url=>url.pathname==="/en/forum");await page.locator("main h1").first().waitFor();
  assert.equal(await page.evaluate(()=>window.__motionRoute===document.querySelector('[data-community-motion="route"]')),true,"SPA_ROUTE_CONTAINER_RETAINED");
  assert.equal(await page.locator('[data-community-motion="route"]').evaluate(el=>el.getAnimations().filter(animation=>animation.playState==="running").length),0,"OFF_ROUTE_STATIC");
  await page.reload();await page.locator("main h1").first().waitFor();
  assert.equal(await page.locator("html").getAttribute("data-motion"),"off","OFF_SURVIVES_RELOAD");
  if(authenticated){
   await visit("/en/settings/profile");const field=page.locator('input[name="nickname"]');await field.waitFor();const previous=await field.inputValue();
   try{
    await field.fill("Motion unsaved draft");await field.evaluate(el=>{window.__motionField=el;});
    await choose("on");await choose("off");
    assert.equal(await field.evaluate(el=>el===window.__motionField),true,"PREFERENCE_PRESERVES_INPUT_INSTANCE");
    assert.equal(await field.inputValue(),"Motion unsaved draft","PREFERENCE_PRESERVES_UNSAVED_INPUT");
    await field.focus();await page.evaluate(()=>{location.hash="motion-check";});
    await page.waitForURL(url=>url.hash==="#motion-check");
    assert.equal(await field.inputValue(),"Motion unsaved draft","HASH_PRESERVES_UNSAVED_INPUT");
    assert.equal(await field.evaluate(el=>el===document.activeElement),true,"HASH_PRESERVES_INPUT_FOCUS");
   }finally{await field.fill(previous);}
  }
 }finally{
  // 先经真实控件恢复 Provider，再恢复本地原值，避免污染后续验收步骤。
  await choose(originalMode);
  await page.evaluate(value=>{if(value===null)localStorage.removeItem("adx-reduce-motion");else localStorage.setItem("adx-reduce-motion",value);delete window.__motionRoute;delete window.__motionField;},stored);
  await page.emulateMedia({reducedMotion:"no-preference"});
 }
}
