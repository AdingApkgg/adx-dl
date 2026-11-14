const {chromium} = await import(process.env.ASTRODX_PLAYWRIGHT_PATH ?? 'playwright');
import {writeFileSync} from 'node:fs';
const root=process.argv[2];
const browser=await chromium.launch({headless:true,executablePath:process.env.ASTRODX_CHROMIUM_PATH,args:['--no-sandbox','--proxy-server=http://127.0.0.1:11090','--proxy-bypass-list=localhost;127.0.0.1']});
const results=[];
try {
for(const [device,width,height] of [['desktop',1440,1000],['mobile',390,844],['narrow',320,740]]) {
 const context=await browser.newContext({viewport:{width,height},locale:'zh-CN',isMobile:device==='mobile',deviceScaleFactor:1});
 const page=await context.newPage();
 page.setDefaultTimeout(15000);
 page.on('pageerror',e=>console.log('PAGEERROR',String(e)));
 const response=await page.goto(`${process.env.ASTRODX_PREVIEW_ORIGIN ?? 'http://127.0.0.1:3313'}/charts/12061`,{waitUntil:'domcontentloaded',timeout:60000});console.log('PAGE',device,response.status(),await page.title());
 await page.locator('main').first().waitFor();
 await page.waitForFunction(()=>{const e=document.querySelector('[data-music-player-surface=collapsed]');return e&&Object.keys(e).some(k=>k.startsWith('__reactProps'))});
 await page.waitForTimeout(1500);
 await page.getByRole('button',{name:'展开播放器',exact:true}).click();

 await page.locator('[data-music-player-panel]').waitFor({state:'visible'});
 await page.waitForTimeout(2500);
 await page.addStyleTag({content:'nextjs-portal { display: none !important; }'});
 await page.screenshot({path:`${root}/${device}-player.png`});
 const playerRect=await page.locator('[data-music-player-panel]').boundingBox();
 results.push({device,panel:'player',rect:playerRect,fullscreen:playerRect.x<1&&playerRect.y<1&&Math.abs(playerRect.width-width)<2&&Math.abs(playerRect.height-height)<2,dialog:await page.locator('[data-music-player-panel]').getAttribute('role'),contentWithinViewport:await page.locator('.music-player-stage, .music-player-footer, .music-player-heading').evaluateAll(es=>es.every(e=>{const r=e.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth+1})),scrollLocked:await page.evaluate(()=>getComputedStyle(document.body).overflow==='hidden')});
 await page.keyboard.press('Escape');
 await page.locator('[data-music-player-panel]').waitFor({state:'hidden'});
 results.push({device,escapeRestoresFocus:await page.getByRole('button',{name:'展开播放器',exact:true}).evaluate(e=>e===document.activeElement)});
 const download=page.locator('[data-download-inline] button').first();
 await page.route('https://astrodx-charts.saop.cc/**', async route=>{await new Promise(r=>setTimeout(r,3000));await route.continue().catch(()=>{});});
 await download.click();
 await page.waitForTimeout(400);
 await page.locator('[data-download-inline] button').evaluateAll(bs=>{const p=bs.find(b=>(b.textContent+' '+b.getAttribute('aria-label')).includes('暂停'));p?.click()});
 await page.getByRole('button',{name:/^展开下载列表/}).click();
 await page.locator('[data-download-manager]').waitFor({state:'visible'});
 await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
 await page.waitForTimeout(1500);
 await page.screenshot({path:`${root}/${device}-downloads.png`});
 const managerRect=await page.locator('[data-download-manager]').boundingBox();
 results.push({device,panel:'downloads',rect:managerRect,withinViewport:managerRect.x>=0&&managerRect.x+managerRect.width<=width,details:await page.locator('[data-download-manager]').evaluate(e=>({parent:e.parentElement.getBoundingClientRect().toJSON(),transform:getComputedStyle(e).transform,parentTransform:getComputedStyle(e.parentElement).transform,ancestors:[e.parentElement,e.parentElement.parentElement].map(n=>({class:n.className,rect:n.getBoundingClientRect().toJSON(),transform:getComputedStyle(n).transform}))})),actions:await page.locator('[data-download-task-actions] button').evaluateAll(bs=>bs.map(b=>({label:b.getAttribute('aria-label')||b.textContent,height:b.getBoundingClientRect().height,width:b.getBoundingClientRect().width}))),text:await page.locator('[data-download-manager]').innerText()});
 console.log('PASS_DEVICE',device,JSON.stringify(results.slice(-3)));
 await context.close();
}
writeFileSync(root+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));if(results.some(r=>r.panel==='player'?!(r.fullscreen&&r.contentWithinViewport&&r.scrollLocked):r.panel==='downloads'?!r.withinViewport:!r.escapeRestoresFocus))process.exitCode=1;
} finally {await browser.close()}
