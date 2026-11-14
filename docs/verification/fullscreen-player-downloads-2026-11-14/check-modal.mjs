const {chromium} = await import(process.env.ASTRODX_PLAYWRIGHT_PATH ?? 'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.ASTRODX_CHROMIUM_PATH,args:['--no-sandbox','--proxy-server=http://127.0.0.1:11090','--proxy-bypass-list=localhost;127.0.0.1']});
try {
 const page=await browser.newPage({viewport:{width:390,height:844},locale:'zh-CN'});
 await page.goto(`${process.env.ASTRODX_PREVIEW_ORIGIN ?? 'http://127.0.0.1:3313'}/charts/12061`,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>{const e=document.querySelector('[data-music-player-surface=collapsed]');return e&&Object.keys(e).some(k=>k.startsWith('__reactProps'))});
 await page.getByRole('button',{name:'展开播放器',exact:true}).click();
 const panel=page.locator('[data-music-player-panel]');await panel.waitFor();
 await panel.locator('ol li button[aria-haspopup=menu]').first().click();
 const menu=page.getByRole('menu');await menu.waitFor();
 if(!await menu.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+15))}))throw Error('Queue menu obscured');
 await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});
 await panel.getByRole('button',{name:'曲库',exact:true}).click();await panel.locator('input').waitFor();
 await panel.getByRole('button',{name:'我的歌单',exact:true}).click();
 await panel.getByRole('button',{name:'新建歌单',exact:true}).waitFor();
 for(let i=0;i<35;i++){await page.keyboard.press('Tab');if(!await panel.evaluate(e=>e.contains(document.activeElement)))throw Error('Focus escaped modal');}
 if(!await page.locator('main').evaluate(e=>!!e.closest('[inert], [aria-hidden=true]')))throw Error('Background exposed to screen reader');
 await page.getByRole('button',{name:'关闭播放器面板',exact:true}).click();await panel.waitFor({state:'hidden'});
 await page.waitForTimeout(100);
 if(!await page.getByRole('button',{name:'展开播放器',exact:true}).evaluate(e=>e===document.activeElement))throw Error('Close did not restore focus');
 console.log('PASS queue menu visible above full screen, library/playlist tabs usable, 35 Tab steps trapped, background hidden, close restores focus');
}finally{await browser.close()}
