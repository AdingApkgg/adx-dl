import type {DownloadPlanItem} from "@/shared/downloads";
export class DownloadWorker {
 private worker:Worker;private next=0;private pending=new Map<number,{resolve:(v:Record<string,unknown>)=>void;reject:(e:Error)=>void}>();
 constructor(signal?:AbortSignal){this.worker=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});this.worker.onmessage=event=>{const p=this.pending.get(event.data.id);if(!p||event.data.progress)return;this.pending.delete(event.data.id);if(event.data.ok)p.resolve(event.data);else p.reject(new Error(event.data.code??'WORKER_FAILED'));};this.worker.onerror=()=>this.close();signal?.addEventListener('abort',()=>this.close(),{once:true});if(signal?.aborted)this.close();}
 private closed=false;
 call(kind:string,data:Record<string,unknown>={},transfer:Transferable[]=[]){if(this.closed)return Promise.reject(new DOMException('Aborted','AbortError'));const id=++this.next;return new Promise<Record<string,unknown>>((resolve,reject)=>{this.pending.set(id,{resolve,reject});try{this.worker.postMessage({id,kind,...data},transfer);}catch(e){this.pending.delete(id);reject(e);}});}
 async hash(blob:Blob){return (await this.call('hash',{blob})).digest as string;}
 async collection(files:{item:DownloadPlanItem;blob:Blob}[]){return (await this.call('collection',{files})).blob as Blob;}
 async startHash(){await this.call('hash-start');}
 async chunk(bytes:Uint8Array){const copy=bytes.slice().buffer;await this.call('hash-chunk',{bytes:copy},[copy]);}
 async endHash(){return (await this.call('hash-end')).digest as string;}
 close(){if(this.closed)return;this.closed=true;this.worker.terminate();for(const p of this.pending.values())p.reject(new DOMException('Aborted','AbortError'));this.pending.clear();}
}
export async function hashDownloadBlob(blob:Blob,signal?:AbortSignal){const worker=new DownloadWorker(signal);try{return await worker.hash(blob);}finally{worker.close();}}
