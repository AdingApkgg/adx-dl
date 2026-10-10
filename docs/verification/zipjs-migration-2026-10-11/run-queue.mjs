import {createServer} from 'node:http';
import {readFile, writeFile, mkdir, stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {build} from '../../../apps/web/node_modules/esbuild/lib/main.js';
const {chromium,webkit}=await import(process.env.PLAYWRIGHT_MODULE||'/Users/i/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const root=process.env.BENCH_ROOT||'/private/tmp/astrodx-zip-bench';
const out=process.env.MIGRATION_ROOT||'/private/tmp/astrodx-capability-queue';
await mkdir(out,{recursive:true});
await build({entryPoints:['docs/verification/zipjs-migration-2026-10-11/queue-browser-entry.ts'],bundle:true,format:'esm',platform:'browser',tsconfig:'apps/web/tsconfig.json',outfile:out+'/bundle.js'});
const server=createServer(async(req,res)=>{
  if(new URL(req.url,'http://localhost').pathname==='/') {res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><button>Save</button><script type="module" src="/bundle.js"></script>');return;}
  const p=req.url==='/bundle.js'?out+'/bundle.js':req.url==='/fixture.json'?root+'/fixture.json':root+req.url;
  try {const info=await stat(p);res.setHeader('Content-Length',info.size);res.setHeader('Content-Type',p.endsWith('.js')?'application/javascript':p.endsWith('.json')?'application/json':'application/octet-stream');createReadStream(p).pipe(res);} catch {res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const results=[];
const individual = process.env.INDIVIDUAL === '1';
try {
for(const engine of (process.env.ENGINE?[process.env.ENGINE]:['chromium','webkit'])) for(const mode of (process.env.MODE?[process.env.MODE]:['stream','unsupported','runtime-failure'])) {
 const context=await(engine==='chromium'?chromium:webkit).launchPersistentContext(out+`/profile-${engine}-${mode}`,{headless:true,acceptDownloads:true,viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',...(engine==='webkit'?{executablePath:process.env.WEBKIT_EXECUTABLE||'/private/tmp/astrodx-playwright/webkit-2336/pw_run.sh'}:{})});
 try {
  if(mode!=='stream') await context.addInitScript(mode=>{
   const storage=navigator.storage;window.originalStorage=storage;
   if(mode==='unsupported') Object.defineProperty(navigator,'storage',{value:{estimate:storage.estimate.bind(storage)}});
   else Object.defineProperty(navigator,'storage',{value:{estimate:storage.estimate.bind(storage),getDirectory:async()=>{
    const root=await storage.getDirectory();return {getDirectoryHandle:async(name,options)=>{
     const dir=await root.getDirectoryHandle(name,options);return {removeEntry:(...args)=>dir.removeEntry(...args),getFileHandle:async(...args)=>{
      const handle=await dir.getFileHandle(...args);return {getFile:()=>handle.getFile(),createWritable:async()=>new WritableStream({write(chunk){if(chunk.length>1)throw new DOMException('Simulated quota loss','QuotaExceededError');}})};
     }};
    }};
   }}});
  },mode);
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}${individual ? "/?individual" : ""}`);await page.waitForFunction(()=>window.startQueue);
  const ids=await page.evaluate(()=>window.startQueue());
  const report={engine,mode,physicalDevice:false,ids,saves:[],errors};
  let state;
  for(let index=0;index<20;index++) {
   await page.waitForFunction(()=>{const state=window.queueState();return state.jobs.some(job=>job.status==='ready'||job.status==='error')||state.historyCount>0&&state.jobs.every(job=>job.status==='success'&&!job.archives?.length);},{},{timeout:180000});
   state=await page.evaluate(()=>window.queueState());
   if(state.jobs.some(job=>job.status==='error'))throw new Error(JSON.stringify(state));
   const job=state.jobs.find(job=>job.status==='ready');if(!job)break;
   const waiting=page.waitForEvent('download');await page.getByRole('button',{name:'Save'}).click();const download=await waiting;
   const target=out+`/${engine}-${mode}-${index}.adx`;await download.saveAs(target);
   report.saves.push({id:job.id,filename:download.suggestedFilename(),bytes:(await stat(target)).size,failure:await download.failure()});
   if(!await page.evaluate(id=>window.confirmQueue(id),job.id))throw new Error('Save confirmation rejected');
   await page.waitForFunction(id=>!window.queueState().jobs.find(job=>job.id===id)?.archives?.length,job.id);
  }
  report.state=await page.evaluate(()=>window.queueState());
  report.remainingFiles=await page.evaluate(async()=>{const root=await(window.originalStorage??navigator.storage).getDirectory();try {const dir=await root.getDirectoryHandle('astrodx-archives');let n=0;for await(const item of dir.values())n++;return n;}catch(e){if(e.name==='NotFoundError')return 0;throw e;}});
  report.pass=ids.length===(individual?6:mode==='unsupported'?3:1)&&report.saves.length===(individual?6:mode==='stream'?1:3)&&report.state.requests===24&&report.state.historyCount===1&&report.remainingFiles===0&&report.saves.every(save=>save.failure===null)&&errors.length===0;
  results.push(report);console.log(JSON.stringify(report));
 } finally {await context.close();}
}
} finally {server.close();await writeFile(out+'/results.json',JSON.stringify(results,null,2));}
if(results.some(result=>!result.pass))process.exitCode=1;
