import {sha256} from "@noble/hashes/sha2.js";
import {createZipCollection} from "./collection";
import {DOWNLOAD_CACHE_BYTES,type DownloadPlanItem} from "@/shared/downloads";
const CHUNK=1024*1024;
const hex=(bytes:Uint8Array)=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
let incremental:ReturnType<typeof sha256.create>|null=null;
self.onmessage=async(event:MessageEvent)=>{const {id,kind}=event.data;try{
 if(kind==='hash-start'){incremental=sha256.create();self.postMessage({id,ok:true});return;}
 if(kind==='hash-chunk'){if(!incremental)throw Error('HASH_NOT_STARTED');incremental.update(new Uint8Array(event.data.bytes));self.postMessage({id,ok:true});return;}
 if(kind==='hash-end'){if(!incremental)throw Error('HASH_NOT_STARTED');const digest=hex(incremental.digest());incremental=null;self.postMessage({id,ok:true,digest});return;}
 if(kind==='hash'){const blob:Blob=event.data.blob;if(!(blob instanceof Blob)||blob.size>DOWNLOAD_CACHE_BYTES)throw Error('BUDGET');const h=sha256.create();for(let offset=0;offset<blob.size;offset+=CHUNK)h.update(new Uint8Array(await blob.slice(offset,offset+CHUNK).arrayBuffer()));self.postMessage({id,ok:true,digest:hex(h.digest())});return;}
 if(kind!=='collection')throw Error('UNKNOWN_OPERATION');
 const files:{item:DownloadPlanItem;blob:Blob}[]=event.data.files;
 const blob=await createZipCollection(files,undefined,(publicId,bytes)=>self.postMessage({id,progress:true,publicId,bytes}));self.postMessage({id,ok:true,blob});

 }catch(error){self.postMessage({id,ok:false,code:error instanceof Error&&['BUDGET','SIZE'].includes(error.message)?error.message:'WORKER_FAILED'});}};
