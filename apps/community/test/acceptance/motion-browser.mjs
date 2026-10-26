import assert from "node:assert/strict";

// 嵌入现有 UI 验收组：只改当前浏览器的外观偏好及未提交输入，不写业务数据。
export async function exerciseMotion({page,origin,authenticated=false}){
 const url=path=>new URL(path,origin).href;
 const visit=async path=>{const response=await page.goto(url(path));assert.equal(response.status(),200,path);await page.locator("main h1").first().waitFor();};
 // 诊断包装：保留原 waitForFunction 与默认超时，失败时先给出唯一label与安全状态。
 async function waitForMotion(label,predicate,arg){
  const snapshot=async()=>{
   try{return await page.evaluate(()=>{
    const transform=el=>el?getComputedStyle(el).transform:"absent";
    const ambient=document.querySelector('[data-community-motion="ambient"]'),rect=ambient?ambient.getBoundingClientRect():null;
    return JSON.stringify({path:location.pathname,visibility:document.visibilityState,motion:document.documentElement.dataset.motion??null,reduce:matchMedia('(prefers-reduced-motion: reduce)').matches,hover:matchMedia('(hover: hover)').matches,fine:matchMedia('(hover: hover) and (pointer: fine)').matches,route:transform(document.querySelector('[data-community-motion="route"]')),routeConnected:window.__motionRoute?window.__motionRoute.isConnected:"absent",routeIsCurrent:window.__motionRoute?window.__motionRoute===document.querySelector('[data-community-motion="route"]'):"absent",observed:window.__motionObserved===undefined?"absent":window.__motionObserved,plate:transform(document.querySelector('.community-chart-card .community-artwork-plate')),ambient:ambient?ambient.getAttribute('data-motion-active'):"absent",ambientRect:rect?{top:Math.round(rect.top),bottom:Math.round(rect.bottom)}:null,innerHeight,scrollY:Math.round(scrollY)});
   });}catch(error){return "STATE_UNAVAILABLE "+error.message;}
  };
  try{return await page.waitForFunction(predicate,arg);}
  catch(error){throw new Error(`MOTION_WAIT_TIMEOUT ${label} ${await snapshot()} :: ${error.message}`);}
 }
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
  await waitForMotion(`SETTLED_${label}`,()=>{const el=document.querySelector('[data-community-motion="route"]'),style=getComputedStyle(el);return Number(style.opacity)>0.999&&Math.abs(new DOMMatrixReadOnly(style.transform).m42)<0.01;});
  const frames=await page.locator('[data-community-motion="route"]').evaluate(async el=>{const values=[];for(let i=0;i<4;i++){await new Promise(requestAnimationFrame);const style=getComputedStyle(el);values.push({opacity:Number(style.opacity),y:new DOMMatrixReadOnly(style.transform).m42});}return values;});
  assert.ok(frames.every(frame=>frame.opacity>0.999&&Math.abs(frame.y)<0.01),label);
 }
 async function choose(mode){
  await page.getByRole("button",{name:"Open settings",exact:true}).filter({visible:true}).click();
  const settings=page.getByRole("dialog",{name:"Settings",exact:true});await settings.waitFor();
  // “Follow system”也出现在主题设置里，用动画组选项的独有说明限定。
  const button=mode==="system"?settings.getByRole("button",{name:/^Follow system Follow your device/}):settings.getByRole("button",{name:labels[mode]});
  await button.click();await waitForMotion(`MODE_${mode.toUpperCase()}`,value=>document.documentElement.dataset.motion===value,mode);
  assert.equal(await button.getAttribute("aria-pressed"),"true");
  await settings.getByRole("button",{name:"Close settings",exact:true}).click();await settings.waitFor({state:"hidden"});
 }
 async function assertOrbitMovement(orbit,label){
  const frames=await orbit.evaluate(async el=>{
   const sample=()=>{const m=new DOMMatrixReadOnly(getComputedStyle(el).transform);return [m.m11,m.m12,m.m21,m.m22,m.m41,m.m42];};
   const values=[sample()];for(let sampleWindow=0;sampleWindow<2;sampleWindow++){for(let frame=0;frame<6;frame++)await new Promise(requestAnimationFrame);values.push(sample());}return values;
  });
  // Numeric movement in both windows rejects a one-time jump and rotate(360)'s
  // non-identical string representation of an effectively identity matrix.
  assert.ok(frames.slice(1).every((value,index)=>Math.hypot(...value.map((v,i)=>v-frames[index][i]))>.0005),`${label}: ${JSON.stringify(frames)}`);
 }
 async function assertOrbitStopped(orbit,label){
  const frames=await orbit.evaluate(async el=>{
   const values=[];for(let frame=0;frame<4;frame++){await new Promise(requestAnimationFrame);const m=new DOMMatrixReadOnly(getComputedStyle(el).transform);values.push([m.m11,m.m12,m.m21,m.m22,m.m41,m.m42]);}return values;
  });
  const identity=[1,0,0,1,0,0];
  assert.ok(frames.every(value=>value.every((v,i)=>Math.abs(v-identity[i])<.00001)),`${label}: ${JSON.stringify(frames)}`);
 }
 let primaryFailed=false,primary;
 try{
  await page.emulateMedia({reducedMotion:"reduce"});await choose("system");
  const card=page.locator(".community-chart-card").first();await card.waitFor();await card.hover();
  assert.equal(await card.evaluate(el=>getComputedStyle(el).translate),"none","SYSTEM_REDUCED_MOTION_HOVER_STATIC");
  await choose("on");await card.hover();
  await waitForMotion("HOVER_LIFT",()=>{const card=document.querySelector(".community-chart-card");return card&&parseFloat(getComputedStyle(card).translate.split(/\s+/)[1])< -1.8;});
  const artwork=card.locator('[data-community-motion="artwork"]'),plate=artwork.locator('.community-artwork-plate');
  const coverBox=await artwork.boundingBox();assert.ok(coverBox,'ARTWORK_BOUNDS');
  await page.mouse.move(coverBox.x+coverBox.width*.8,coverBox.y+coverBox.height*.25);
  await waitForMotion("ARTWORK_TILT",()=>{const el=document.querySelector('.community-chart-card .community-artwork-plate');if(!el)return false;const m=new DOMMatrixReadOnly(getComputedStyle(el).transform);return Math.abs(m.m13)>.01||Math.abs(m.m23)>.01;});
  assert.ok(Number(await artwork.locator('.community-artwork-sheen').evaluate(el=>getComputedStyle(el).opacity))>0,'ARTWORK_POINTER_HIGHLIGHT');
  await page.mouse.move(2,2);
  await waitForMotion("ARTWORK_RETURN",()=>{const el=document.querySelector('.community-chart-card .community-artwork-plate');if(!el)return false;const m=new DOMMatrixReadOnly(getComputedStyle(el).transform);return Math.abs(m.m13)<.001&&Math.abs(m.m23)<.001&&Math.abs(m.m11-1)<.001;});
  // A touch pointer must not re-enable mouse-only tilt or hijack scrolling.
  await artwork.dispatchEvent('pointermove',{pointerType:'touch',clientX:coverBox.x+coverBox.width*.8,clientY:coverBox.y+coverBox.height*.25});
  assert.equal(await plate.evaluate(el=>{const m=new DOMMatrixReadOnly(getComputedStyle(el).transform);return Math.abs(m.m13)<.001&&Math.abs(m.m23)<.001;}),true,'TOUCH_ARTWORK_STAYS_STATIC');
  await page.emulateMedia({reducedMotion:"no-preference"});await choose("system");
  await page.evaluate(()=>{window.__motionRoute=document.querySelector('[data-community-motion="route"]');});await observeEntry();
  await page.locator('.community-primary-link[href="/en/forum"]').click();await page.waitForURL(url=>url.pathname==="/en/forum");
  await page.locator(".community-forum-page").waitFor();
  await waitForMotion("ROUTE_ENTRY_OBSERVED",()=>window.__motionObserved===true);await page.emulateMedia({reducedMotion:"reduce"});
  await assertSettled("SYSTEM_CHANGE_SETTLES_REAL_ROUTE_FRAMES");
  assert.equal(await page.evaluate(()=>window.__motionRoute===document.querySelector('[data-community-motion="route"]')),true,"SPA_ROUTE_CONTAINER_RETAINED");
  await page.emulateMedia({reducedMotion:"no-preference"});await choose("on");
  await page.getByRole("button",{name:"Open settings",exact:true}).filter({visible:true}).click();
  const settings=page.getByRole("dialog",{name:"Settings",exact:true}),off=settings.getByRole("button",{name:labels.off});await off.click({trial:true});
  // 浏览器后退时全局设置仍保持打开，直接用真实开关中断页面进入。
  await observeEntry();await page.goBack();await page.waitForURL(url=>url.pathname==="/en/charts");await waitForMotion("ROUTE_ENTRY_OBSERVED_BACK",()=>window.__motionObserved===true);
  await off.click();await waitForMotion("MODE_OFF_APPLIED",()=>document.documentElement.dataset.motion==="off");await assertSettled("EXPLICIT_OFF_SETTLES_REAL_ROUTE_FRAMES");
  await settings.getByRole("button",{name:"Close settings",exact:true}).click();await settings.waitFor({state:"hidden"});await card.hover();
  assert.equal(await card.evaluate(el=>getComputedStyle(el).translate),"none","EXPLICIT_OFF_HOVER_STATIC");
  assert.equal(await plate.evaluate(el=>new DOMMatrixReadOnly(getComputedStyle(el).transform).isIdentity),true,'EXPLICIT_OFF_ARTWORK_STATIC');
  await page.reload();await page.locator("main h1").first().waitFor();
  assert.equal(await page.locator("html").getAttribute("data-motion"),"off","OFF_SURVIVES_RELOAD");
  await page.emulateMedia({reducedMotion:'reduce'});await visit('/en');await choose('system');
  const scene=page.locator('[data-community-motion="ambient"]');await scene.waitFor();
  assert.equal(await scene.getAttribute('data-motion-active'),'false','SYSTEM_REDUCED_AMBIENT_INACTIVE');
  await choose('on');
  await waitForMotion("AMBIENT_ACTIVE_ON",()=>document.querySelector('[data-community-motion="ambient"]')?.getAttribute('data-motion-active')==='true');
  const orbit=scene.locator('.community-hero-orbit.is-outer');
  await assertOrbitMovement(orbit,'MANUAL_ON_OVERRIDES_MOUNTED_OS_REDUCTION');
  await choose('system');
  assert.equal(await scene.getAttribute('data-motion-active'),'false','SYSTEM_REDUCTION_STOPS_ORBIT');
  await assertOrbitStopped(orbit,'SYSTEM_REDUCTION_REST_FRAMES');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await waitForMotion("AMBIENT_ACTIVE_SYSTEM_RESTORE",()=>document.querySelector('[data-community-motion="ambient"]')?.getAttribute('data-motion-active')==='true');
  await assertOrbitMovement(orbit,'SYSTEM_CHANGE_RESTARTS_REAL_ORBIT');
  await choose('off');
  assert.equal(await scene.getAttribute('data-motion-active'),'false','EXPLICIT_OFF_AMBIENT_INACTIVE');
  await assertOrbitStopped(orbit,'EXPLICIT_OFF_ORBIT_STATIC');
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
 }catch(error){primary=error;primaryFailed=true;}
 // 清理逐项独立尝试：保留首次错误，其余步骤仍继续，避免掩盖主流程失败。
 let cleanupFailed=false,cleanupError;
 const attemptCleanup=async action=>{try{await action();}catch(error){if(!cleanupFailed){cleanupFailed=true;cleanupError=error;}}};
 await attemptCleanup(()=>choose(originalMode));
 await attemptCleanup(()=>page.evaluate(value=>{if(value===null)localStorage.removeItem("adx-reduce-motion");else localStorage.setItem("adx-reduce-motion",value);window.__motionObserver?.disconnect();delete window.__motionObserver;delete window.__motionObserved;delete window.__motionRoute;delete window.__motionField;},stored));
 await attemptCleanup(()=>page.emulateMedia({reducedMotion:"no-preference"}));
 if(primaryFailed)throw primary;
 if(cleanupFailed)throw cleanupError;
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
