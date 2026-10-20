import type {ComponentType} from "react";
import {QueryClientProvider,dehydrate} from "@tanstack/react-query";
import {fireEvent,render,screen,within} from "@testing-library/react";
import {createMemoryRouter,RouterProvider} from "react-router";
import {expect,test,vi} from "vitest";
import {ChartSummary} from "@/client/components/chart-summary";
import Forum from "@/client/routes/forum";
import Workbench from "@/client/routes/workbench";
import {workbenchQuery} from "@/client/queries/charts";
import {createApiClient} from "@/shared/api-client";
import {makeQueryClient} from "@/shared/query-client";
import type {ChartImportSummary} from "@/shared/charts";
import {m} from "@/paraglide/messages.js";
const WorkbenchPage=Workbench as unknown as ComponentType<{loaderData:{actor:string;dehydratedState:ReturnType<typeof dehydrate>}}> ;
const api=createApiClient("https://community.test");
vi.mock("@/client/lib/browser",()=>({getRenderApi:()=>api,getBrowserApi:()=>api}));
const summary:ChartImportSummary={title:"Chart",artist:"Artist",maidataMd5Base64:"hash",audio:null,hasCover:false,warnings:[],difficulties:[{difficulty:6,level:"14+",noteCount:10,durationMs:2000,previewSupported:true},{difficulty:7,level:null,noteCount:null,durationMs:null,previewSupported:false}]};
test("difficulty actions target the exact supported slot and preserve unknown unsupported data",()=>{
 const preview=vi.fn();render(<ChartSummary summary={summary} onPreview={preview}/>);
 fireEvent.click(screen.getByRole("button",{name:m.ui_preview_difficulty({name:"Re:MASTER"})}));expect(preview).toHaveBeenCalledWith(6);
 expect(screen.getAllByRole("button")).toHaveLength(1);expect(screen.getByText(m.chart_metadata_unknown(),{exact:false})).toBeTruthy();
});
test("forum board navigation preserves filters, clears pagination and exposes a full reset",()=>{
 const router=createMemoryRouter([{path:"*",element:<Forum loaderData={{userId:null,page:{boards:[{id:"first",name:"First board",description:"Description",order:1,readOnly:false,revision:1,topicCount:0,replyCount:0},{id:"second",name:"Second board",description:"Readonly",order:2,readOnly:true,revision:1,topicCount:0,replyCount:0}],topics:{items:[],pinned:[],nextCursor:null}}}} params={{}} matches={[] as never}/>}],{initialEntries:["/forum?q=星&sort=published&chart=1&unanswered=true&cursor=old"]});render(<RouterProvider router={router}/>);
 const link=screen.getByRole("link",{name:/Second board/}),at=new URL(link.getAttribute("href")!,"https://community.test");
 expect(at.searchParams.get("q")).toBe("星");expect(at.searchParams.get("sort")).toBe("published");expect(at.searchParams.get("chart")).toBe("1");expect(at.searchParams.get("unanswered")).toBe("true");expect(at.searchParams.get("board")).toBe("second");expect(at.searchParams.has("cursor")).toBe(false);
 expect(screen.getAllByRole("link",{name:m.ui_clear_filters()}).every(a=>a.getAttribute("href")==="/forum")).toBe(true);
});
test("workbench uses server quota and reservation and keeps attention filters scoped",()=>{
 const client=makeQueryClient(),filters={q:"星",status:"draft",changed:false,warnings:false,pending:false};
 client.setQueryData(workbenchQuery(api,"alice",filters).queryKey,{items:[],nextCursor:null,targets:[],counts:{total:4,private:2,published:2,changed:1,warnings:1,pending:1,hidden:0},usage:{usedBytes:8*1048576,reservedBytes:2*1048576,quotaBytes:64*1048576}});
 const router=createMemoryRouter([{path:"*",element:<QueryClientProvider client={client}><WorkbenchPage loaderData={{actor:"alice",dehydratedState:dehydrate(client)}}/></QueryClientProvider>}],{initialEntries:["/me/workbench?q=星&status=draft&cursor=old"]});render(<RouterProvider router={router}/>);
 const meter=screen.getByRole("meter") as HTMLMeterElement;expect(meter.value).toBe(10*1048576);expect(meter.max).toBe(64*1048576);
 const attention=screen.getByRole("region",{name:m.ui_workbench_attention()}),link=within(attention).getByRole("link",{name:new RegExp(m.author_warnings())}),at=new URL(link.getAttribute("href")!,"https://community.test");expect(at.searchParams.get("q")).toBe("星");expect(at.searchParams.get("warnings")).toBe("1");expect(at.searchParams.has("cursor")).toBe(false);
 const changed=new URL(screen.getByRole("link",{name:m.author_changed()}).getAttribute("href")!,"https://community.test");expect(changed.searchParams.get("q")).toBe("星");expect(changed.searchParams.get("changed")).toBe("1");expect(changed.searchParams.has("status")).toBe(false);expect(changed.searchParams.has("cursor")).toBe(false);
 expect(screen.getByText(m.ui_workbench_publish_hint())).toBeTruthy();expect(document.querySelector("#publication")).toBeNull();
});
