import { QueryClientProvider } from "@tanstack/react-query";
import { act,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach,expect,test,vi } from "vitest";
import { FollowAuthor } from "@/client/components/follow-author";
import { PrivateDiscussionGuard } from "@/client/components/discussion-ui";
import { makeQueryClient } from "@/shared/query-client";
import { m } from "@/paraglide/messages.js";
function view(me:{id:string;publicId:string;status:string}|null){const client=makeQueryClient();client.setQueryData(["me"],me);const result=render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/charts/1"]}><FollowAuthor publicId="2"/><PrivateDiscussionGuard userId="viewer"><p>Private following row</p></PrivateDiscussionGuard></MemoryRouter></QueryClientProvider>);return {...result,client};}
afterEach(()=>vi.unstubAllGlobals());
test("anonymous author follow returns to this chart without reading private APIs",()=>{const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);view(null);expect(screen.getByRole("link",{name:m.following_follow()}).getAttribute("href")).toContain("next=%2Fcharts%2F1");expect(fetcher).not.toHaveBeenCalled();});
test("follow explicitly defaults alerts off and enables alerts through a second revisioned request",async()=>{
 let state={revision:0,following:false,notify:false,followedAt:null as string|null};const writes:unknown[]=[];
 vi.stubGlobal("fetch",vi.fn(async(_url:unknown,init?:RequestInit)=>{if(init?.method==="PUT"){expect(new Headers(init.headers).get("content-type")).toBe("application/json");const body=JSON.parse(String(init.body));writes.push(body);state={...state,...body,revision:state.revision+1,followedAt:new Date().toISOString()};}return Response.json(state);}));
 view({id:"viewer",publicId:"1",status:"active"});
 const follow=await screen.findByRole("button",{name:m.following_follow()});fireEvent.click(follow);await screen.findByRole("button",{name:m.following_unfollow()});
 expect(writes[0]).toEqual({expectedRevision:0,following:true,notify:false});expect((screen.getByRole("checkbox",{name:m.following_notify()}) as HTMLInputElement).checked).toBe(false);
 fireEvent.click(screen.getByRole("checkbox",{name:m.following_notify()}));await waitFor(()=>expect(writes).toHaveLength(2));expect(writes[1]).toEqual({expectedRevision:1,following:true,notify:true});
});
test("private loader data disappears when the current account changes",async()=>{
 vi.stubGlobal("fetch",vi.fn(async()=>Response.json({revision:0,following:false,notify:false,followedAt:null})));
 const {client}=view({id:"viewer",publicId:"1",status:"active"});expect(screen.getByText("Private following row")).toBeTruthy();
 await act(async()=>{client.setQueryData(["me"],{id:"different-account",publicId:"3",status:"active"});});
 await waitFor(()=>expect(screen.queryByText("Private following row")).toBeNull());
});
test("a private API failure remains an error rather than an unfollowed state",async()=>{
 vi.stubGlobal("fetch",vi.fn(async()=>Response.json({error:{code:"STORAGE_BUSY",message:"retry"}},{status:503})));
 view({id:"viewer",publicId:"1",status:"active"});await screen.findByText(m.following_load_failed(),{},{timeout:10000});expect(screen.queryByRole("button",{name:m.following_follow()})).toBeNull();
});
