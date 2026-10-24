import assert from "node:assert/strict";

// 嵌入现有 UI 验收组：只改当前浏览器的外观偏好及未提交输入，不写业务数据。
export async function exerciseMotion({page,origin,authenticated=false}){
 const url=path=>new URL(path,origin).href;
 const visit=async path=>{const response=await page.goto(url(path));assert.equal(response.status(),200,path);await page.locator("main h1").first().waitFor();};
 await page.setViewportSize({width:1280,height:900});await visit("/en/charts");
 const stored=await page.evaluate(()=>localStorage.getItem("adx-reduce-motion"));
 const originalMode=stored==="on"?"on":stored==="off"||stored==="1"?"off":"system";
 const labels={on:/^Motion on/,off:/^Reduce motion/,system:/^Follow system/};
 async function observeEntry(){
  await page.evaluate(()=>{
   window.__motionObserver?.disconnect();window.__motionObserved=false;
   const root=document.querySelector('[data-community-motion="route"]');let frame;
   // 同时观察WAAPI与JS驱动的实际样式，不依赖style属性是否被逐帧改写。
   const sample=()=>{const style=getComputedStyle(root),matrix=new DOMMatrixReadOnly(style.transform);if(Number(style.opacity)<0.999||Math.abs(matrix.m42)>0.01)window.__motionObserved=true;else frame=requestAnimationFrame(sample);};
   window.__motionObserver={disconnect:()=>cancelAnimationFrame(frame)};frame=requestAnimationFrame(sample);
  });
 }
 async function assertSettled(label){
  await page.waitForFunction(()=>{const el=document.querySelector('[data-community-motion="route"]'),style=getComputedStyle(el);return Number(style.opacity)>0.999&&Math.abs(new DOMMatrixReadOnly(style.transform).m42)<0.01;});
  const frames=await page.locator('[data-community-motion="route"]').evaluate(async el=>{const values=[];for(let i=0;i<4;i++){await new Promise(requestAnimationFrame);const style=getComputedStyle(el);values.push({opacity:Number(style.opacity),y:new DOMMatrixReadOnly(style.transform).m42});}return values;});
  assert.ok(frames.every(frame=>frame.opacity>0.999&&Math.abs(frame.y)<0.01),label);
 }
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
  await page.emulateMedia({reducedMotion:"no-preference"});await choose("system");
  await page.evaluate(()=>{window.__motionRoute=document.querySelector('[data-community-motion="route"]');});await observeEntry();
  await page.locator('.community-primary-link[href="/en/forum"]').click();await page.waitForURL(url=>url.pathname==="/en/forum");
  await page.locator(".community-forum-page").waitFor();
  await page.waitForFunction(()=>window.__motionObserved===true);await page.emulateMedia({reducedMotion:"reduce"});
  await assertSettled("SYSTEM_CHANGE_SETTLES_REAL_ROUTE_FRAMES");
  assert.equal(await page.evaluate(()=>window.__motionRoute===document.querySelector('[data-community-motion="route"]')),true,"SPA_ROUTE_CONTAINER_RETAINED");
  await page.emulateMedia({reducedMotion:"no-preference"});await choose("on");
  await page.getByRole("button",{name:"Open settings",exact:true}).filter({visible:true}).click();
  const settings=page.getByRole("dialog",{name:"Settings",exact:true}),off=settings.getByRole("button",{name:labels.off});await off.click({trial:true});
  // 浏览器后退时全局设置仍保持打开，直接用真实开关中断页面进入。
  await observeEntry();await page.goBack();await page.waitForURL(url=>url.pathname==="/en/charts");await page.waitForFunction(()=>window.__motionObserved===true);
  await off.click();await page.waitForFunction(()=>document.documentElement.dataset.motion==="off");await assertSettled("EXPLICIT_OFF_SETTLES_REAL_ROUTE_FRAMES");
  await settings.getByRole("button",{name:"Close settings",exact:true}).click();await settings.waitFor({state:"hidden"});await card.hover();
  assert.equal(await card.evaluate(el=>getComputedStyle(el).translate),"none","EXPLICIT_OFF_HOVER_STATIC");
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
  await page.evaluate(value=>{if(value===null)localStorage.removeItem("adx-reduce-motion");else localStorage.setItem("adx-reduce-motion",value);window.__motionObserver?.disconnect();delete window.__motionObserver;delete window.__motionObserved;delete window.__motionRoute;delete window.__motionField;},stored);
  await page.emulateMedia({reducedMotion:"no-preference"});
 }
}

// 在已加载的中文谱面预览上操作外观偏好；不重新加载预览或更改难度。
export async function exerciseMotionPlayer({page,preview,playing=false}){
 const stored=await page.evaluate(()=>localStorage.getItem('adx-reduce-motion'));
 const original=stored==='on'?'on':stored==='off'||stored==='1'?'off':'system';
 const names={on:/^开启动画/,off:/^减少动画/,system:/^跟随系统 遵循设备/};
 const canvas=preview.locator('canvas'),seek=preview.getByRole('slider',{name:'拖动预览时间轴',exact:true}),difficulty=await preview.getByRole('combobox',{name:'难度',exact:true}).inputValue();
 await canvas.evaluate(el=>{window.__motionCanvas=el;});await seek.evaluate(el=>{window.__motionSeek=el;});
 async function choose(mode){
  await page.getByRole('button',{name:'打开设置',exact:true}).filter({visible:true}).click();const sheet=page.getByRole('dialog',{name:'设置',exact:true});await sheet.waitFor();await sheet.getByRole('button',{name:names[mode]}).click();
  await page.waitForFunction(mode=>document.documentElement.dataset.motion===mode,mode);await sheet.getByRole('button',{name:'关闭设置',exact:true}).click();await sheet.waitFor({state:'hidden'});
 }
 try{
  for(const mode of ['off','on']){
   const before=Number(await seek.inputValue());await choose(mode);
   assert.equal(await canvas.evaluate(el=>el===window.__motionCanvas),true,'MOTION_PRESERVES_PLAYER_CANVAS');assert.equal(await seek.evaluate(el=>el===window.__motionSeek),true,'MOTION_PRESERVES_PLAYER_CONTROL');assert.equal(await preview.getByRole('combobox',{name:'难度',exact:true}).inputValue(),difficulty);
   const after=Number(await seek.inputValue());
   if(playing){assert.equal(await preview.getByRole('button',{name:'暂停',exact:true}).isVisible(),true,'MOTION_PRESERVES_PLAYING');assert.ok(after>=before,'MOTION_MUST_NOT_RESET_CLOCK');}
   else{assert.ok(Math.abs(after-before)<=0.03,'MOTION_PRESERVES_PAUSED_POSITION');assert.equal(await preview.getByRole('button',{name:'播放',exact:true}).isEnabled(),true);}
   assert.equal(await preview.getByRole('alert').count(),0,'MOTION_PLAYER_RENDER_ERROR');
  }
 }finally{
  await choose(original);await page.evaluate(value=>{if(value===null)localStorage.removeItem('adx-reduce-motion');else localStorage.setItem('adx-reduce-motion',value);delete window.__motionCanvas;delete window.__motionSeek;},stored);
 }
}
