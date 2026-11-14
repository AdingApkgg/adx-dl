import http from 'node:http';
import { chromium } from '/home/i/astrodx-verify/public-browser-20261016/node_modules/playwright/index.mjs';
const recorder = `window.trace=[];function record(type,detail){const row={type,detail,path:location.pathname,time:performance.now()};trace.push(row);const all=JSON.parse(sessionStorage.getItem('trace')||'[]');all.push(row);sessionStorage.setItem('trace',JSON.stringify(all.slice(-80)));console.log('NATIVE',JSON.stringify(row));}record('boot',document.readyState);addEventListener('pagereveal',e=>{record('pagereveal',!!e.viewTransition);if(e.viewTransition){e.viewTransition.ready.then(()=>record('ready',document.getAnimations().map(a=>({name:a.animationName,pseudo:a.effect?.pseudoElement,duration:a.effect?.getTiming().duration}))),e=>record('ready-error',String(e)));e.viewTransition.finished.then(()=>record('finished',true),e=>record('finished-error',String(e)));}});addEventListener('pageswap',e=>{record('pageswap',!!e.viewTransition);if(e.viewTransition)e.viewTransition.ready.catch(e=>record('outgoing-ready-error',String(e)));});addEventListener('pageshow',e=>record('pageshow',e.persisted));addEventListener('error',e=>record('error',e.message));addEventListener('unhandledrejection',e=>record('rejection',String(e.reason)));`;
const css = '@view-transition{navigation:auto;types:adx-document;}@keyframes adx-page-enter{from{opacity:0;transform:translateY(12px)}}@keyframes adx-page-exit{to{opacity:0;transform:translateY(-8px)}}::view-transition-new(root){animation:adx-page-enter .32s ease-out both}::view-transition-old(root){animation:adx-page-exit .18s ease-out both}';
const server=http.createServer((req,res)=>{res.setHeader('content-type','text/html');res.end(`<!doctype html><html><head><script>${recorder}</script><style>${css}</style></head><body><h1>${req.url}</h1><a href="${req.url==='/a'?'/b':'/a'}">Native next</a></body></html>`);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({...(process.env.NATIVE_BROWSER ? {executablePath:process.env.NATIVE_BROWSER} : {}),headless:true});
try {
 for(const mode of ['plain','route','init']){
  const context=await browser.newContext();
  if(mode==='route')await context.route('**/*',r=>r.continue());
  if(mode==='init')await context.addInitScript(()=>{window.init=(window.init||0)+1;});
  const page=await context.newPage();
  const messages=[];page.on('console',m=>messages.push(m.text()));page.on('pageerror',e=>messages.push('PAGEERROR '+e.stack));
  await page.goto(origin+'/a');await page.waitForTimeout(250);
  await page.getByRole('link',{name:'Native next'}).click();
  await page.waitForURL(origin+'/b');await page.waitForTimeout(1000);
  console.log(JSON.stringify({mode,messages,state:await page.evaluate(()=>({trace,stored:JSON.parse(sessionStorage.getItem('trace')),url:location.href,visibility:document.visibilityState}))}));
  await page.goBack();await page.waitForTimeout(700);console.log(JSON.stringify({mode,back:await page.evaluate(()=>({trace,stored:JSON.parse(sessionStorage.getItem('trace'))}))}));await page.goForward();await page.waitForTimeout(700);console.log(JSON.stringify({mode,forward:await page.evaluate(()=>({trace}))}));await context.close();
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
