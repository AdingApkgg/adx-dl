import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import { AppealComposer, AppealReviewForm } from "@/client/components/governance-ui";
import { PrivateDiscussionGuard } from "@/client/components/discussion-ui";
import { m } from "@/paraglide/messages.js";
import { createApiClient } from "@/shared/api-client";
import { makeQueryClient } from "@/shared/query-client";
const api=createApiClient("https://community.test");
vi.mock("@/client/lib/browser",()=>({getBrowserApi:()=>api,getRenderApi:()=>api}));
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
const decision={key:"decision:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",entity:"message",targetId:"private",action:"hide",publicReason:"Public reason",createdAt:"2026-10-20T00:00:00.000Z",appealId:null};
function mount(node:ReactNode){const client=makeQueryClient();client.setQueryData(['me'],{id:'owner',name:'Owner',status:'active',isAdmin:true});const router=createMemoryRouter([{path:'*',Component:()=> <PrivateDiscussionGuard userId="owner">{node}</PrivateDiscussionGuard>}]);render(<QueryClientProvider client={client}><RouterProvider router={router}/></QueryClientProvider>);return client;}
test("appeal requires meaningful text and confirmation; unknown response keeps draft",async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('network');}));
 mount(<AppealComposer decision={decision}/>);
 fireEvent.change(screen.getByLabelText(m.governance_appeal_reason()),{target:{value:'Please recheck'}});
 const button=screen.getByRole('button',{name:m.governance_submit()});expect(button.hasAttribute('disabled')).toBe(true);
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(button);
 await screen.findByRole('alert');expect((screen.getByLabelText(m.governance_appeal_reason()) as HTMLTextAreaElement).value).toBe('Please recheck');
});
test("changing identity unmounts private form and ignores the pending submission",async()=>{
 let release:(r:Response)=>void=()=>{};vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(resolve=>{release=resolve;})));
 const client=mount(<AppealComposer decision={decision}/>);
 fireEvent.change(screen.getByLabelText(m.governance_appeal_reason()),{target:{value:'Private draft'}});fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:m.governance_submit()}));
 client.setQueryData(['me'],{id:'other',name:'Other',status:'active'});
 await waitFor(()=>expect(screen.queryByText('Private draft')).toBeNull());
 release(Response.json({id:'a',decisionKey:decision.key,reason:'Private draft',status:'open',revision:1}));
 await waitFor(()=>expect(screen.queryByLabelText(m.governance_appeal_reason())).toBeNull());
});
test("resolved appeal has no mutable review form",()=>{
 mount(<AppealReviewForm appeal={{id:'a',decisionKey:decision.key,reason:'reason',publicReason:'Public reason',status:'upheld',revision:2,createdAt:decision.createdAt,resolvedAt:decision.createdAt,resolutionNote:'Reviewed'}}/>);
 expect(screen.queryByRole('button',{name:m.governance_resolve()})).toBeNull();
});

test("open appeal exposes an accessible outcome selector and requires confirmation",()=>{
 mount(<AppealReviewForm appeal={{id:'a',decisionKey:decision.key,reason:'reason',publicReason:'Public reason',status:'open',revision:1,createdAt:decision.createdAt,resolvedAt:null,resolutionNote:null}}/>);
 const outcome=screen.getByRole('combobox',{name:m.governance_result()});fireEvent.change(outcome,{target:{value:'review_required'}});expect((outcome as HTMLSelectElement).value).toBe('review_required');expect(screen.getByRole('button',{name:m.governance_resolve()}).hasAttribute('disabled')).toBe(true);
});
