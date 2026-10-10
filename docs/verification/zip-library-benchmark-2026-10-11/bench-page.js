const fixture=await(await fetch('/fixture.json')).json();
window.ready=true;
window.run=async({lib,repeats,sink})=>{
 const files=new Map([...document.querySelector('input').files].map(f=>[f.name,f]));
 const entries=[];
 for(let r=0;r<repeats;r++)for(const c of fixture)for(const f of c.files)entries.push({name:`Test ${r+1}/${c.dir}/${f.name}`,file:files.get(f.local)});
 console.log('IMPORT',lib);const module=await import(lib==='zipjs'?'/zipjs/package/index.js':'/clientzip/package/index.js');
 let destination,handle;
 if(sink==='opfs'){
  if(!navigator.storage?.getDirectory)throw Error('OPFS unavailable');
  console.log('OPFS ROOT');const root=await navigator.storage.getDirectory();console.log('OPFS HANDLE');handle=await root.getFileHandle('archive.adx',{create:true});console.log('OPFS WRITER');destination=await handle.createWritable();console.log('OPFS OPEN');
 }
 console.log('IMPORTED');window.phase='packing';window.entryCount=entries.length;window.inputBytes=entries.reduce((n,e)=>n+e.file.size,0);
 let last=performance.now(),maxGapMs=0,ticks=0;const timer=setInterval(()=>{const now=performance.now();maxGapMs=Math.max(maxGapMs,now-last);last=now;ticks++;},20);
 const start=performance.now();
 try{
  if(lib==='zipjs'){
   const writer=new module.ZipWriter(destination??new module.BlobWriter('application/zip'),{level:0,useWebWorkers:false,bufferedWrite:false,extendedTimestamp:false,ntfsTimestamp:false,lastModDate:new Date(2020,0,1)});
   for(const entry of entries){console.log('ADD',entry.name,entry.file?.size);await writer.add(entry.name,new module.BlobReader(entry.file));}
   const output=await writer.close();window.archive=sink==='opfs'?await handle.getFile():output;
  }else{
   const stream=module.makeZip((function*(){for(const entry of entries)yield {name:entry.name,input:entry.file,lastModified:new Date(2020,0,1)}})());
   if(destination){await stream.pipeTo(destination);window.archive=await handle.getFile();}else window.archive=await new Response(stream).blob();
  }
  window.phase='ready';return {durationMs:performance.now()-start,inputBytes:window.inputBytes,archiveBytes:window.archive.size,entryCount:entries.length,maxGapMs,ticks,opfs:sink==='opfs'};
 }catch(e){throw new Error(JSON.stringify({name:e?.name,message:e?.message,code:e?.code,value:String(e)}));}finally{clearInterval(timer);}
};
document.querySelector('button').onclick=()=>{const a=document.createElement('a');window.url=URL.createObjectURL(window.archive);a.href=window.url;a.download='benchmark.adx';a.click();};
window.release=async()=>{URL.revokeObjectURL(window.url);window.archive=null;document.querySelector('input').value='';if(navigator.storage?.getDirectory){const root=await navigator.storage.getDirectory();try{await root.removeEntry('archive.adx');}catch{}}};
