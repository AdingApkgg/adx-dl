import {beforeEach,expect,test,vi} from "vitest";
const io=vi.hoisted(()=>({plan:[] as unknown[],identity:"alice",epoch:"epoch",lease:null as null|{owner:string;token:string},saveError:false,loadError:false,created:0,active:0,peak:0,hashing:0,hashPeak:0,
 workbench:vi.fn(),binding:vi.fn(),createOnce:vi.fn(),appendOnce:vi.fn(),init:vi.fn(),file:vi.fn(),cancel:vi.fn(),deleteFile:vi.fn(),held:[] as (()=>void)[]}));
vi.mock("../../src/client/lib/browser",()=>({getBrowserApi:()=>({})}));
vi.mock("../../src/client/queries/charts",()=>({chartsApi:()=>io}));
vi.mock("../../src/client/queries/storage",()=>({storageApi:()=>io}));
vi.mock("../../src/client/imports/persistence",()=>({
 activateImportScope:async(scope:string)=>{if(io.identity!==scope){io.identity=scope;io.epoch=crypto.randomUUID();io.plan=[];}return {scope,epoch:io.epoch,changed:false};},
 loadImportPlan:async()=>{if(io.loadError)throw Error("SCOPE_CHANGED");return structuredClone(io.plan);},saveImportPlan:async(_scope:unknown,_lease:unknown,rows:unknown[])=>{if(io.saveError)throw Error("PERSISTENCE");io.plan=structuredClone(rows);},
 claimImportExecutor:async(_scope:unknown,lease:{owner:string;token:string})=>{if(io.lease)return false;io.lease=lease;return true;},
 fenceImportExecutor:async(scope:{scope:string;epoch:string},lease:{token:string})=>{if(scope.scope!==io.identity||scope.epoch!==io.epoch)throw Error("SCOPE_CHANGED");if(io.lease?.token!==lease.token)throw Error("EXECUTOR_BUSY");},
 invalidateImportScope:async()=>{io.identity="inactive";io.epoch=crypto.randomUUID();io.plan=[];},
 releaseImportExecutor:async(lease:{token:string})=>{if(io.lease?.token===lease.token)io.lease=null;},
}));
vi.mock("../../src/client/lib/file-upload",()=>({
 hashFile:async(file:File)=>{io.hashing++;io.hashPeak=Math.max(io.hashPeak,io.hashing);await Promise.resolve();io.hashing--;return (file.name.startsWith("a")?"a":"b").repeat(64);},
 createUploadController:({api,onState}:{api:typeof io;onState:(s:unknown)=>void})=>({start:async(file:File)=>{io.active++;io.peak=Math.max(io.peak,io.active);try{await api.init(file);onState({phase:"ready",progress:1,file:{id:crypto.randomUUID(),state:"ready",chart:{},purpose:"chart-source"}});}finally{io.active--;}}
 ,resume:vi.fn(),dispose:vi.fn(),forget:vi.fn(),cancel:async()=>{}}),
}));
import {ImportStore} from "../../src/client/imports/store";
import {ApiError} from "../../src/shared/api-client";
const page=()=>({counts:{total:0},targets:[],usage:{usedBytes:0,reservedBytes:0,quotaBytes:268435456}});
beforeEach(()=>{vi.clearAllMocks();io.plan=[];io.identity="alice";io.epoch="epoch";io.lease=null;io.saveError=false;io.loadError=false;io.created=0;io.active=0;io.peak=0;io.hashing=0;io.hashPeak=0;
 io.workbench.mockImplementation(async()=>page());io.binding.mockImplementation(async()=>({state:"unbound"}));io.init.mockImplementation(async()=>({id:crypto.randomUUID(),expiresAt:new Date(Date.now()+86400000).toISOString()}));
 io.createOnce.mockImplementation(async(fileId:string)=>{io.created++;return {id:crypto.randomUUID(),versions:[{id:crypto.randomUUID(),sourceFileId:fileId}]};});
});
test("serial preparation/upload, explicit row saves and partial outcomes",async()=>{
 const store=new ImportStore();await store.activate("alice");await store.add([{file:new File(["a"],"a.zip")},{file:new File(["b"],"b.adx")}]);
 expect(io.init).not.toHaveBeenCalled();await store.start();expect(io.hashPeak).toBe(1);expect(io.peak).toBe(1);expect(io.created).toBe(0);
 const ids=store.getSnapshot().rows.map(r=>r.id);io.createOnce.mockRejectedValueOnce(new ApiError(409,"CHART_DRAFT_LIMIT","limit"));await store.save(ids);
 expect(store.getSnapshot().rows.map(r=>r.phase)).toEqual(["ready","saved"]);expect(io.created).toBe(1);
});
test("ambiguous saves are reconciled without another create; deleted results stay unavailable",async()=>{
 const store=new ImportStore();await store.activate("alice");await store.add([{file:new File(["a"],"a.zip")}]);await store.start();const id=store.getSnapshot().rows[0].id;
 io.createOnce.mockRejectedValueOnce(new TypeError("response lost"));await store.save([id]);expect(store.getSnapshot().rows[0].phase).toBe("uncertain");
 const result={state:"bound",chartId:crypto.randomUUID(),versionId:crypto.randomUUID()};io.binding.mockResolvedValue(result);await store.reconcile([id]);expect(store.getSnapshot().rows[0].phase).toBe("saved");expect(io.createOnce).toHaveBeenCalledTimes(1);
 io.binding.mockResolvedValue({state:"unavailable"});await store.reconcile([id]);expect(store.getSnapshot().rows[0].phase).toBe("failed");await expect(store.reselect(id,{file:new File(["a"],"a.zip")})).rejects.toThrow("RECONCILE_FIRST");expect(io.createOnce).toHaveBeenCalledTimes(1);
});
test("lost executor fencing blocks upload reservation and old account callbacks",async()=>{
 const store=new ImportStore();await store.activate("alice");await store.add([{file:new File(["a"],"a.zip")}]);
 io.workbench.mockImplementationOnce(async()=>{io.identity="bob";io.epoch="other";return page();});await expect(store.start()).rejects.toThrow("SCOPE_CHANGED");expect(io.init).not.toHaveBeenCalled();store.halt();expect(store.getSnapshot().rows).toEqual([]);
});

test("persistence quota failure retains the in-memory plan and ready result without losing executor fences",async()=>{
 const store=new ImportStore();await store.activate("alice");io.saveError=true;await store.add([{file:new File(["a"],"a.zip")}]);expect(store.getSnapshot().persistent).toBe(false);expect(store.getSnapshot().rows).toHaveLength(1);
 await store.start();expect(io.init).toHaveBeenCalledOnce();expect(store.getSnapshot().rows[0].phase).toBe("ready");
 io.identity="bob";await expect(store.save([store.getSnapshot().rows[0].id])).rejects.toThrow("SCOPE_CHANGED");expect(io.createOnce).not.toHaveBeenCalled();
});
test("scope fencing failure during activation never falls back to an active old identity",async()=>{
 const store=new ImportStore();io.loadError=true;await store.activate("alice");expect(store.getSnapshot().scope).toBeNull();expect(store.getSnapshot().capable).toBe(false);await expect(store.add([{file:new File(["a"],"a.zip")}])).rejects.toThrow("SCOPE_CHANGED");
});
test("single save uses one abortable request and fences its UI commit after identity invalidation",async()=>{
 const store=new ImportStore();await store.activate("alice");await store.runSingle("/me/charts/new",{file:new File(["a"],"a.zip")});
 let resolve!:(value:unknown)=>void;io.createOnce.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const commit=vi.fn(async()=>{});
 const saving=store.saveSingle("/me/charts/new",{kind:"new"},commit);void saving.catch(()=>{});
 await vi.waitFor(()=>expect(io.createOnce).toHaveBeenCalledOnce());const signal=io.createOnce.mock.calls[0][1] as AbortSignal;store.halt();expect(signal.aborted).toBe(true);resolve({id:crypto.randomUUID(),versions:[]});await expect(saving).rejects.toThrow("SCOPE_CHANGED");expect(commit).not.toHaveBeenCalled();
});

test("confirmed sign-out invalidates persisted scope and same-account reactivation cannot restore the old plan",async()=>{
 const store=new ImportStore();await store.activate("alice");await store.add([{file:new File(["a"],"a.zip")}]);expect(io.plan).toHaveLength(1);await store.activate(null);expect(store.getSnapshot().scope).toBeNull();expect(io.plan).toHaveLength(0);await store.activate("alice");expect(store.getSnapshot().rows).toHaveLength(0);
});
