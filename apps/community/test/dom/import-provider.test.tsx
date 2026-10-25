import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {act,render,screen,waitFor} from "@testing-library/react";
import {MemoryRouter} from "react-router";
import {expect,test,vi} from "vitest";
const mock=vi.hoisted(()=>({activate:vi.fn(),onChange:null as null|(()=>void),snapshot:{scope:"a" as string|null,rows:[],single:null,persistent:true,capable:true,busy:false,failure:null}}));
vi.mock("@/client/imports/store",()=>({ImportStore:class{getSnapshot=()=>mock.snapshot;getServerSnapshot=()=>({...mock.snapshot,scope:null});subscribe=()=>()=>{};activate=mock.activate;connect=(fn:()=>void)=>{mock.onChange=fn;return()=>{};};}}));
import {ImportProvider,useImports} from "@/client/imports/provider";
function State(){const imports=useImports();return <><p data-testid="scope">{imports?.snapshot.scope??"suspended"}</p><p data-testid="actor">{imports?.actor??"suspended"}</p></>;}
test("failed fresh identity validation leaves old-account imports suspended",async()=>{
 vi.stubGlobal("fetch",vi.fn(async()=>Response.json({error:{message:"offline"}},{status:503})));
 const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:30000}}});client.setQueryData(["me"],{id:"a",status:"active"});
 render(<MemoryRouter><QueryClientProvider client={client}><ImportProvider><State/></ImportProvider></QueryClientProvider></MemoryRouter>);
 await waitFor(()=>expect(mock.activate).toHaveBeenCalledWith("a"));await act(async()=>mock.onChange!());await waitFor(()=>expect(client.getQueryState(["me"])?.fetchStatus).toBe("idle"));expect(screen.getByTestId("scope").textContent).toBe("suspended");expect(screen.getByTestId("actor").textContent).toBe("suspended");
});

test("identity invalidation starts a new server read instead of accepting an older in-flight identity",async()=>{
 let release!:(response:Response)=>void;let calls=0;
 vi.stubGlobal("fetch",vi.fn(async()=>{calls++;if(calls===1)return new Promise<Response>(resolve=>{release=resolve;});return Response.json({id:"b",status:"active"});}));
 const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:30000}}});client.setQueryData(["me"],{id:"a",status:"active"});
 render(<MemoryRouter><QueryClientProvider client={client}><ImportProvider><State/></ImportProvider></QueryClientProvider></MemoryRouter>);
 const older=client.refetchQueries({queryKey:["me"],exact:true});void older.catch(()=>{});
 try{await waitFor(()=>expect(calls).toBe(1));await act(async()=>mock.onChange!());await waitFor(()=>expect(calls).toBe(2));await waitFor(()=>expect(mock.activate).toHaveBeenCalledWith("b"));}
 finally{release(Response.json({id:"a",status:"active"}));await older;}
 expect(client.getQueryData(["me"])).toMatchObject({id:"b"});
});

test("both device queues share the latest identity round without canceling each other's validation",async()=>{
 const {refreshMe}=await import("@/client/queries/me"),{createApiClient}=await import("@/shared/api-client");let release!:(response:Response)=>void,calls=0;
 vi.stubGlobal("fetch",vi.fn(async()=>{calls++;return calls===1?new Promise<Response>(resolve=>{release=resolve;}):Response.json({id:"b",status:"active"});}));
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}}),api=createApiClient("https://community.test");
 const first=refreshMe(client,api);await waitFor(()=>expect(calls).toBe(1));const second=refreshMe(client,api);release(Response.json({id:"a",status:"active"}));
 expect(await first).toMatchObject({id:"b"});expect(await second).toMatchObject({id:"b"});expect(calls).toBe(2);expect(client.getQueryData(["me"])).toMatchObject({id:"b"});
});

test("UX hydration: a validated actor is separate from device queue initialization",()=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:30000}}});client.setQueryData(["me"],{id:"a",status:"active"});mock.snapshot={...mock.snapshot,scope:null};
 render(<MemoryRouter><QueryClientProvider client={client}><ImportProvider><State/></ImportProvider></QueryClientProvider></MemoryRouter>);
 expect(screen.getByTestId("scope").textContent).toBe("suspended");expect(screen.getByTestId("actor").textContent).toBe("a");
});
