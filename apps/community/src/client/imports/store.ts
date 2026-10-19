import type {FileDto} from "@/shared/storage";
import type {WorkbenchPage} from "@/shared/author-workbench";
import {ApiError} from "@/shared/api-client";
import {getBrowserApi} from "../lib/browser";
import {createUploadController,hashFile,type UploadController,type UploadRecord,type UploadSnapshot} from "../lib/file-upload";
import {packChartFolder,packChartParts} from "../lib/chart-input";
import {chartsApi} from "../queries/charts";
import {storageApi,type StorageApi} from "../queries/storage";
import {IMPORT_TTL,importFailure,selectionInfo,validatePlan,type ImportRow,type ImportSelection} from "./model";
import * as persistence from "./persistence";
import type {ImportScope,Executor} from "./persistence";
export type ImportSnapshot={scope:string|null;rows:ImportRow[];persistent:boolean;capable:boolean;busy:boolean;failure:string|null;single:{origin:string;state:UploadSnapshot}|null};
const empty:ImportSnapshot={scope:null,rows:[],persistent:false,capable:false,busy:false,failure:null,single:null};
export class ImportStore {
 private snapshot:ImportSnapshot=empty;private listeners=new Set<()=>void>();private scope:ImportScope|null=null;private generation=0;private owner=crypto.randomUUID();
 private selections=new Map<string,ImportSelection>();private prepared=new Map<string,File>();private controller:UploadController|null=null;private active:AbortController|null=null;
 private executor:Executor|null=null;private database=false;private operation:Promise<unknown>|null=null;private channel:BroadcastChannel|null=null;private singleController:UploadController|null=null;
 getSnapshot=()=>this.snapshot;getServerSnapshot=()=>empty;subscribe=(f:()=>void)=>{this.listeners.add(f);return()=>this.listeners.delete(f);};
 private emit(patch:Partial<ImportSnapshot>={}){this.snapshot={...this.snapshot,...patch,rows:[...(patch.rows??this.snapshot.rows)]};for(const f of this.listeners)f();}
 private check(g:number){if(g!==this.generation||!this.scope||this.active?.signal.aborted)throw Error("SCOPE_CHANGED");}
 private async fence(g:number){this.check(g);if(this.database&&this.executor)await persistence.fenceImportExecutor(this.scope!,this.executor);this.check(g);}
 private async call<T>(g:number,fn:()=>Promise<T>):Promise<T>{await this.fence(g);const value=await fn();await this.fence(g);return value;}
 private async persist(g:number){await this.fence(g);if(this.database&&this.executor)try{await persistence.saveImportPlan(this.scope!,this.executor,this.snapshot.rows);}catch(e){this.check(g);if(e instanceof Error&&["SCOPE_CHANGED","EXECUTOR_BUSY"].includes(e.message))throw e;this.emit({persistent:false,failure:"PERSISTENCE"});}this.check(g);}
 connect(onIdentity:()=>void){
  const invalid=()=>{this.halt();onIdentity();};
  if(typeof BroadcastChannel==="function"){this.channel=new BroadcastChannel("adxc-import-identity");this.channel.onmessage=e=>{if(e.data?.kind==="identity")invalid();else if(e.data?.kind==="plan"&&!this.snapshot.busy)void this.refreshLocal();};}
  const storage=(e:StorageEvent)=>{if(e.key==="adxc-import-identity")invalid();};window.addEventListener("storage",storage);
  const offline=()=>this.pause();window.addEventListener("offline",offline);
  return()=>{window.removeEventListener("storage",storage);window.removeEventListener("offline",offline);this.channel?.close();this.channel=null;this.halt();};
 }
 private announceIdentity(){this.channel?.postMessage({kind:"identity"});try{localStorage.setItem("adxc-import-identity",crypto.randomUUID());}catch{}}
 async activate(owner:string|null){
  if(owner===this.scope?.scope)return;
  this.halt();if(!owner)return;const g=this.generation;
  this.emit({scope:owner});
  try{const identity=await persistence.activateImportScope(owner);if(g!==this.generation)return;this.database=true;this.scope=identity;if(identity.changed)this.announceIdentity();const rows=await persistence.loadImportPlan(identity);this.check(g);this.emit({rows,persistent:true,capable:true});}
  catch{if(g!==this.generation)return;this.database=false;this.scope={scope:owner,epoch:crypto.randomUUID()};this.emit({persistent:false,capable:!!navigator.locks?.request,failure:"PERSISTENCE"});}
 }
 halt(){++this.generation;this.active?.abort();this.controller?.dispose();this.singleController?.dispose();this.scope=null;this.selections.clear();this.prepared.clear();this.controller=null;this.singleController=null;this.emit({...empty});}
 async clear(){this.halt();await persistence.activateImportScope(`cleared:${crypto.randomUUID()}`).catch(()=>{});this.announceIdentity();}
 private async refreshLocal(){const g=this.generation,scope=this.scope;if(!scope||!this.database)return;try{const rows=await persistence.loadImportPlan(scope);this.check(g);this.emit({rows});}catch{}}
 private async execute<T>(fn:(g:number,signal:AbortSignal)=>Promise<T>,single=false):Promise<T>{
  if(this.snapshot.busy||this.operation)throw Error("EXECUTOR_BUSY");if(!this.scope)throw Error("SCOPE_CHANGED");if(!single&&!this.snapshot.capable)throw Error("PERSISTENCE");
  const g=this.generation,aborter=new AbortController();this.active=aborter;this.emit({busy:true,failure:null});
  const run=async()=>{
   const executor={owner:this.owner,token:crypto.randomUUID()};this.executor=executor;
   let timer:ReturnType<typeof setInterval>|undefined;
   try{
    if(this.database){if(!await persistence.claimImportExecutor(this.scope!,executor))throw Error("EXECUTOR_BUSY");timer=setInterval(()=>{void this.fence(g).catch(()=>aborter.abort());},5000);}
    await this.fence(g);return await fn(g,aborter.signal);
   }finally{clearInterval(timer);if(this.database)await persistence.releaseImportExecutor(executor).catch(()=>{});if(this.executor===executor)this.executor=null;}
  };
  const operation=(navigator.locks?.request?navigator.locks.request("adxc-import-executor",{mode:"exclusive",ifAvailable:true},lock=>{if(!lock)throw Error("EXECUTOR_BUSY");return run();}):run());
  this.operation=operation;
  try{return await operation;}catch(error){if(g===this.generation){for(const row of this.snapshot.rows){if(["packing","hashing","queued","uploading","processing"].includes(row.phase))this.update(row,{phase:"paused",failure:importFailure(error)});else if(row.phase==="saving")this.update(row,{phase:"uncertain",failure:"RECONCILE_FIRST"});}this.emit({failure:importFailure(error)});}throw error;}
  finally{if(this.operation===operation)this.operation=null;if(this.active===aborter)this.active=null;if(g===this.generation)this.emit({busy:false});this.channel?.postMessage({kind:"plan"});}
 }
 private async sync(g:number){if(!this.database)return;const stored=await persistence.loadImportPlan(this.scope!);this.check(g);const own=new Map(this.snapshot.rows.map(r=>[r.id,r]));this.emit({rows:stored.map(r=>own.has(r.id)?{...r,phase:own.get(r.id)!.phase,progress:own.get(r.id)!.progress}:r)});}
 async add(selections:ImportSelection[]){await this.execute(async(g)=>{await this.sync(g);let rows=this.snapshot.rows;if(rows.every(r=>["saved","cancelled"].includes(r.phase)))rows=[];const now=Date.now();const added=selections.map(selection=>{const info=selectionInfo(selection);if("file" in selection&&!/\.(adx|zip)$/i.test(selection.file.name))throw Error("TYPE_NOT_ALLOWED");return {id:crypto.randomUUID(),name:info.name.slice(0,240),size:info.size,rawSize:info.rawSize,createdAt:now,expiresAt:now+IMPORT_TTL,phase:"confirmation" as const,progress:0,target:null};});validatePlan([...rows,...added]);added.forEach((r,i)=>this.selections.set(r.id,selections[i]));this.emit({rows:[...rows,...added]});await this.persist(g);});}
 async map(id:string,target:{id:string;revision:number}|null){await this.execute(async g=>{await this.sync(g);const row=this.row(id);if(["saved","saving","uncertain","cancelled"].includes(row.phase))throw Error("RECONCILE_FIRST");const rows=this.snapshot.rows.map(r=>r.id===id?{...r,target,failure:undefined}:r);validatePlan(rows);this.emit({rows});await this.persist(g);});}
 private row(id:string){const row=this.snapshot.rows.find(r=>r.id===id);if(!row)throw Error("IMPORT_MISSING");if(row.expiresAt<=Date.now())throw Error("UPLOAD_EXPIRED");return row;}
 private update(row:ImportRow,patch:Partial<ImportRow>){Object.assign(row,patch);this.emit({rows:this.snapshot.rows.map(r=>r.id===row.id?{...row}:r)});}
 private async workbench(g:number,signal:AbortSignal){return this.call(g,()=>chartsApi(getBrowserApi()).workbench({},signal));}
 private checkCapacity(row:ImportRow,page:WorkbenchPage,all=false){
  const targets=this.snapshot.rows.filter(r=>!["saved","cancelled"].includes(r.phase));
  if(row.target){const target=page.targets.find(t=>t.id===row.target!.id);if(!target)throw Error("NOT_FOUND");if(target.revision!==row.target.revision)throw Error("CHART_CHANGED");if(target.versionCount>=20)throw Error("CHART_VERSION_LIMIT");}
  else if(page.counts.total+(all?targets.filter(r=>!r.target).length:1)>50)throw Error("CHART_DRAFT_LIMIT");
  const bytes=all?targets.filter(r=>!r.uploadId&&!r.fileId).reduce((n,r)=>n+r.size,0):row.uploadId||row.fileId?0:row.size;
  if(page.usage.usedBytes+page.usage.reservedBytes+bytes>page.usage.quotaBytes)throw Error("QUOTA_EXCEEDED");
 }
 private api(g:number,row?:ImportRow):StorageApi{
  const api=storageApi(getBrowserApi());return new Proxy(api,{get:(_t,key:keyof StorageApi)=>async(...args:unknown[])=>{
   const value=await this.call(g,()=>Reflect.apply(api[key],api,args)) as unknown;
   if(key==="init"&&row&&value&&typeof value==="object"&&"id" in value){const dto=value as {id:string;expiresAt:string};this.update(row,{uploadId:dto.id,expiresAt:Math.min(row.expiresAt,Date.parse(dto.expiresAt))});await this.persist(g);}
   return value;
  }}) as StorageApi;
 }
 private recoveryStorage(){try{return localStorage;}catch{return {getItem:()=>null,setItem:()=>{},removeItem:()=>{}};}}
 private async upload(g:number,file:File,record:UploadRecord|undefined,onState:(state:UploadSnapshot)=>void,row?:ImportRow):Promise<void>{
  this.controller?.dispose();
  await new Promise<void>((resolve,reject)=>{
   const signal=this.active!.signal;let settled=false;
   const finish=(error?:unknown)=>{if(settled)return;settled=true;signal.removeEventListener("abort",abort);error?reject(error):resolve();};
   const abort=()=>{this.controller?.dispose();finish(new DOMException("Aborted","AbortError"));};signal.addEventListener("abort",abort,{once:true});
   const controller=createUploadController({purpose:"chart-source",api:this.api(g,row),userId:this.scope!.scope,storage:this.recoveryStorage(),onState:state=>{if(g!==this.generation||signal.aborted)return;onState(state);if(state.phase==="ready")finish();else if(state.phase==="error")finish(state.error??Error("IMPORT_FAILED"));}});
   this.controller=controller;if(!row)this.singleController=controller;
   void(record?controller.resume(file,record):controller.start(file)).catch(finish);
   if(signal.aborted)abort();
  });
 }
 private async pack(selection:ImportSelection,signal:AbortSignal){return "file" in selection?selection.file:"folder" in selection?packChartFolder(selection.folder,signal):packChartParts(selection.parts,signal);}
 async start(){await this.execute(async(g,signal)=>{
  await this.sync(g);validatePlan(this.snapshot.rows);
  const pending=this.snapshot.rows.filter(r=>!r.fileId&&!r.result&&["confirmation","queued","paused","failed"].includes(r.phase));
  // Validate all source bytes and mappings before the first network reservation.
  for(const row of pending){const selection=this.selections.get(row.id);if(!selection){this.update(row,{phase:"paused",failure:"RESELECT_FILE"});throw Error("RESELECT_FILE");}this.update(row,{phase:"packing",failure:undefined});const file=await this.pack(selection,signal);await this.fence(g);this.update(row,{phase:"hashing"});const hash=await hashFile(file,{signal,onProgress:progress=>{if(g===this.generation)this.update(row,{progress});}});await this.fence(g);if(row.hash&&(row.hash!==hash||row.size!==file.size))throw Error("HASH_MISMATCH");this.prepared.set(row.id,file);this.update(row,{hash,size:file.size,phase:"queued",progress:0});}
  validatePlan(this.snapshot.rows);const before=await this.workbench(g,signal);for(const row of pending)this.checkCapacity(row,before,true);await this.persist(g);
  for(const row of pending){try{
   this.checkCapacity(row,await this.workbench(g,signal));const file=this.prepared.get(row.id)!;
   const record=row.uploadId?{schemaVersion:2 as const,purpose:"chart-source" as const,uploadId:row.uploadId,name:row.name,size:row.size,hash:row.hash!,expiry:new Date(row.expiresAt).toISOString()}:undefined;
   await this.upload(g,file,record,state=>{this.update(row,{phase:state.phase==="error"?"failed":state.phase==="idle"?"paused":state.phase,progress:state.progress,...(state.file?{fileId:state.file.id}:{}),...(state.error?{failure:importFailure(state.error)}:{})});},row);
   this.prepared.delete(row.id);this.selections.delete(row.id);await this.persist(g);
  }catch(error){this.check(g);this.update(row,{phase:signal.aborted?"paused":"failed",failure:importFailure(error)});await this.persist(g);if(signal.aborted)throw error;}}
 });}
 pause(){this.active?.abort();this.controller?.dispose();for(const row of this.snapshot.rows)if(["queued","packing","hashing","uploading","processing"].includes(row.phase))this.update(row,{phase:"paused",failure:"RESELECT_FILE"});}
 async reselect(id:string,selection:ImportSelection){await this.execute(async(g,signal)=>{await this.sync(g);const row=this.row(id);if(row.fileId||row.result||["saved","cancelled","uncertain","ready","saving"].includes(row.phase))throw Error("RECONCILE_FIRST");const file=await this.pack(selection,signal),hash=await hashFile(file,{signal});await this.fence(g);if(row.hash&&(hash!==row.hash||file.size!==row.size))throw Error("HASH_MISMATCH");this.selections.set(id,{file});this.prepared.set(id,file);this.update(row,{hash,size:file.size,phase:"confirmation",failure:undefined});await this.persist(g);});}
 async reconcile(ids:string[]){await this.execute(async(g,signal)=>{await this.sync(g);for(const id of ids){const row=this.row(id);try{
  if(!row.fileId&&row.uploadId){const upload=await this.call(g,()=>this.api(g).upload(row.uploadId!,signal));if(upload.state==="ready"&&upload.fileId)row.fileId=upload.fileId;else{this.update(row,{phase:"paused",failure:upload.state==="receiving"||upload.state==="processing"?"RESELECT_FILE":"NOT_FOUND"});continue;}}
  if(!row.fileId){this.update(row,{phase:"paused",failure:"RESELECT_FILE"});continue;}
  const binding=await this.call(g,()=>chartsApi(getBrowserApi()).binding(row.fileId!,signal));
  if(binding.state==="bound"){if(row.target&&row.target.id!==binding.chartId)throw Error("CHART_FILE_ASSIGNED");this.update(row,{phase:"saved",result:{chartId:binding.chartId,versionId:binding.versionId},failure:undefined});}
  else if(binding.state==="unbound"&&!row.result){const file=await this.call(g,()=>this.api(g).file(row.fileId!,signal));if(file.state!=="ready"||!file.chart)throw Error("CHART_FILE_NOT_READY");this.update(row,{phase:"ready",failure:undefined});}
  else this.update(row,{phase:"failed",failure:"NOT_FOUND"});
 }catch(error){this.check(g);this.update(row,{phase:"failed",failure:importFailure(error)});}await this.persist(g);}});}
 async save(ids:string[]){await this.execute(async(g,signal)=>{await this.sync(g);for(const id of ids){const row=this.row(id);if(row.phase!=="ready"||!row.fileId)continue;this.update(row,{phase:"saving",failure:undefined});await this.persist(g);
  try{
   const binding=await this.call(g,()=>chartsApi(getBrowserApi()).binding(row.fileId!,signal));if(binding.state!=="unbound"){this.update(row,{phase:"uncertain",failure:"RECONCILE_FIRST"});await this.persist(g);continue;}
   this.checkCapacity(row,await this.workbench(g,signal));const api=chartsApi(getBrowserApi());
   const chart=await this.call(g,()=>row.target?api.appendOnce(row.target.id,row.fileId!,row.target.revision,signal):api.createOnce(row.fileId!,signal));
   const version=chart.versions.find(v=>v.sourceFileId===row.fileId);if(!version)throw Error("IMPORT_FAILED");
   this.update(row,{phase:"saved",result:{chartId:chart.id,versionId:version.id}});
  }catch(error){this.check(g);this.update(row,{phase:error instanceof ApiError&&error.status<500?"ready":"uncertain",failure:importFailure(error)});}
  await this.persist(g);
 }});}
 async cancel(ids:string[]){this.pause();await this.operation?.catch(()=>{});await this.execute(async(g,signal)=>{await this.sync(g);for(const id of ids){const row=this.row(id);if(row.phase==="saved")continue;try{
  if(row.fileId){const binding=await this.call(g,()=>chartsApi(getBrowserApi()).binding(row.fileId!,signal));if(binding.state!=="unbound"){this.update(row,{phase:binding.state==="bound"?"uncertain":"cancelled",failure:binding.state==="bound"?"RECONCILE_FIRST":"NOT_FOUND"});continue;}await this.call(g,()=>this.api(g).deleteFile(row.fileId!));}
  else if(row.uploadId){const upload=await this.call(g,()=>this.api(g).upload(row.uploadId!,signal));if(upload.fileId){row.fileId=upload.fileId;this.update(row,{phase:"uncertain",failure:"RECONCILE_FIRST"});await this.persist(g);continue;}await this.call(g,()=>this.api(g).cancel(row.uploadId!));}
  this.update(row,{phase:"cancelled",failure:undefined});this.selections.delete(id);this.prepared.delete(id);
 }catch(error){this.check(g);this.update(row,{failure:importFailure(error)});}await this.persist(g);}});}
 async remove(id:string){await this.execute(async g=>{await this.sync(g);const row=this.row(id);if((row.uploadId||row.fileId)&&!["saved","cancelled"].includes(row.phase)||!["confirmation","queued","failed","paused","cancelled","saved"].includes(row.phase))throw Error("CANCEL_FIRST");this.selections.delete(id);this.prepared.delete(id);this.emit({rows:this.snapshot.rows.filter(r=>r.id!==id)});await this.persist(g);});}
 async runSingle(origin:string,selection:ImportSelection,record?:UploadRecord){await this.execute(async(g,signal)=>{
  if(this.snapshot.rows.some(r=>!["saved","cancelled"].includes(r.phase)))throw Error("BATCH_ACTIVE");
  if(this.snapshot.single?.origin&&this.snapshot.single.origin!==origin&&this.snapshot.single.state.phase!=="idle")throw Error("BATCH_ACTIVE");
  this.emit({single:{origin,state:{phase:"hashing",progress:0}}});const file=await this.pack(selection,signal);await this.fence(g);
  await this.upload(g,file,record,state=>this.emit({single:{origin,state}}));this.singleController=this.controller;
 },true);}
 async saveSingle(origin:string,fn:(file:FileDto)=>Promise<void>){await this.execute(async g=>{const single=this.snapshot.single;if(single?.origin!==origin||single.state.phase!=="ready"||!single.state.file)return;await this.call(g,()=>fn(single.state.file!));if(single.state.uploadId)this.singleController?.forget(single.state.uploadId);this.emit({single:null});},true);}
 async cancelSingle(origin:string){this.pause();await this.operation?.catch(()=>{});await this.execute(async(g,signal)=>{const single=this.snapshot.single;if(single?.origin!==origin)return;const state=single.state;if(state.file){const binding=await this.call(g,()=>chartsApi(getBrowserApi()).binding(state.file!.id,signal));if(binding.state!=="unbound")throw Error("RECONCILE_FIRST");await this.call(g,()=>this.api(g).deleteFile(state.file!.id));}else await this.singleController?.cancel();if(state.uploadId)this.singleController?.forget(state.uploadId);this.singleController?.dispose();this.singleController=null;this.emit({single:null});},true);}
}
