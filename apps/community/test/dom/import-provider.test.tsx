import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {act,render,screen,waitFor} from "@testing-library/react";
import {MemoryRouter} from "react-router";
import {expect,test,vi} from "vitest";
const mock=vi.hoisted(()=>({activate:vi.fn(),onChange:null as null|(()=>void),snapshot:{scope:"a",rows:[],single:null,persistent:true,capable:true,busy:false,failure:null}}));
vi.mock("@/client/imports/store",()=>({ImportStore:class{getSnapshot=()=>mock.snapshot;getServerSnapshot=()=>({...mock.snapshot,scope:null});subscribe=()=>()=>{};activate=mock.activate;connect=(fn:()=>void)=>{mock.onChange=fn;return()=>{};};}}));
import {ImportProvider,useImports} from "@/client/imports/provider";
function State(){return <p data-testid="scope">{useImports()?.snapshot.scope??"suspended"}</p>;}
test("failed fresh identity validation leaves old-account imports suspended",async()=>{
 vi.stubGlobal("fetch",vi.fn(async()=>Response.json({error:{message:"offline"}},{status:503})));
 const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:30000}}});client.setQueryData(["me"],{id:"a",status:"active"});
 render(<MemoryRouter><QueryClientProvider client={client}><ImportProvider><State/></ImportProvider></QueryClientProvider></MemoryRouter>);
 await waitFor(()=>expect(mock.activate).toHaveBeenCalledWith("a"));await act(async()=>mock.onChange!());await waitFor(()=>expect(client.getQueryState(["me"])?.fetchStatus).toBe("idle"));expect(screen.getByTestId("scope").textContent).toBe("suspended");
});
