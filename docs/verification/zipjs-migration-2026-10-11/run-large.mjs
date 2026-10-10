// Run from repo root; requires the previously downloaded real BGA fixture.
import {createServer} from 'node:http';
import {readFile, writeFile, mkdir, stat} from 'node:fs/promises';
const {chromium, webkit}=await import(process.env.PLAYWRIGHT_MODULE||'/Users/i/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
import {build} from '../../../apps/web/node_modules/esbuild/lib/main.js';
const root = process.env.BENCH_ROOT||'/private/tmp/astrodx-zip-bench';
const out = process.env.MIGRATION_ROOT||'/private/tmp/astrodx-capability-large';
await mkdir(out, {recursive:true});
await build({entryPoints:['docs/verification/zipjs-migration-2026-10-11/browser-entry.ts'],bundle:true,format:'esm',platform:'browser',outfile:out+'/bundle.js'});
const fixture=JSON.parse(await readFile(root+'/fixture.json','utf8'));
const server=createServer(async(req,res)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><input type="file" multiple><button>Save</button><script type="module" src="/bundle.js"></script>');}
  else{res.setHeader('Content-Type','application/javascript');res.end(await readFile(out+'/bundle.js'));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const results=[];
try {
for(const engine of ['chromium']) {
  for(const mode of ['disk']) {
    const context=await (engine==='chromium'?chromium:webkit).launchPersistentContext(out+`/profiles/${engine}-${mode}`,{headless:true,acceptDownloads:true,viewport:{width:390,height:844},isMobile:true,hasTouch:true,...(engine==='webkit'?{executablePath:process.env.WEBKIT_EXECUTABLE||'/private/tmp/astrodx-playwright/webkit-2336/pw_run.sh'}:{})});
    const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    if(mode!=='disk') await context.addInitScript(mode=>{
      const storage=navigator.storage; window.originalStorage=storage;
      if(mode==='unsupported') Object.defineProperty(navigator,'storage',{value:{estimate:storage.estimate.bind(storage)}});
      else {
        const original=storage.getDirectory.bind(storage);
        Object.defineProperty(navigator,'storage',{value:{estimate:storage.estimate.bind(storage),getDirectory:async()=>{
          const root=await original();return {getDirectoryHandle:async(name,options)=>{
            const dir=await root.getDirectoryHandle(name,options);return {
              removeEntry:(...args)=>dir.removeEntry(...args),
              getFileHandle:async(...args)=>{const handle=await dir.getFileHandle(...args);return {
                getFile:()=>handle.getFile(),
                createWritable:async()=>new WritableStream({write(){throw new DOMException('Simulated quota exceeded','QuotaExceededError');}}),
              };},
            };
          }};
        }}});
      }
    },mode);
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(()=>typeof window.pack==='function');
    const charts=Array.from({length:15},(_,index)=>fixture.map(chart=>({...chart,dir:`Test ${index+1} ${chart.dir}`}))).flat(); // Repeat six real BGA charts fifteen times to exercise ZIP64 beyond 4 GiB.
    await page.locator('input').setInputFiles(charts.flatMap(c=>c.files.map(f=>root+'/assets/'+f.local)));
    const result={engine,mode,physicalDevice:false,...await page.evaluate(charts=>window.pack(charts),charts)};
    const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Save'}).click();
    const download=await pending;const target=out+`/${engine}-${mode}.adx`;await download.saveAs(target);
    result.filename=download.suggestedFilename();result.failure=await download.failure();result.savedBytes=(await stat(target)).size;
    await page.evaluate(()=>window.release());
    // Use the prototype to bypass only the harness's unsupported/failure overrides.
    result.remainingFiles=await page.evaluate(async()=>{
      const root=await StorageManager.prototype.getDirectory.call(window.originalStorage??navigator.storage);
      try {const dir=await root.getDirectoryHandle('astrodx-archives');let n=0;for await(const item of dir.values())n++;return n;}catch(e){if(e.name==='NotFoundError')return 0;throw e;}
    });
    result.errors=errors;result.pass=result.diskBacked===(mode==='disk')&&result.failure===null&&result.savedBytes===result.size&&result.filename==='谱面-BGA.adx'&&result.remainingFiles===0&&errors.length===0;
    results.push(result);console.log(JSON.stringify(result));await context.close();
  }
}
} finally {server.close();await writeFile(out+'/results.json',JSON.stringify(results,null,2));}
if(results.length!==1||results.some(result=>!result.pass))process.exitCode=1;
