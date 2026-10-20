import type {ComponentType} from "react";
import {QueryClientProvider} from "@tanstack/react-query";
import {fireEvent,render,screen,within} from "@testing-library/react";
import {createMemoryRouter,RouterProvider} from "react-router";
import {expect,test,vi} from "vitest";
import Editor from "@/client/routes/list-edit";
import type {LibraryList} from "@/shared/library";
import {makeQueryClient} from "@/shared/query-client";
import {createApiClient} from "@/shared/api-client";
import {m} from "@/paraglide/messages.js";
const api=createApiClient('https://community.test');
vi.mock('@/client/lib/browser',()=>({getRenderApi:()=>api,getBrowserApi:()=>api}));
const Page=Editor as unknown as ComponentType<{loaderData:{userId:string;page:LibraryList};params:{id:string}}>;
function view(count=21){const client=makeQueryClient();client.setQueryData(['me'],{id:'alice',status:'active'});const list:LibraryList={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',publicId:'7',revision:1,name:'Private list',description:'',entries:Array.from({length:count},(_,i)=>({id:`entry-${i+1}`,publicId:String(i+1),chart:null})),publiclyAvailable:false,publication:null,moderation:null,createdAt:'2026-10-21T00:00:00Z',updatedAt:'2026-10-21T00:00:00Z'};const router=createMemoryRouter([{path:'*',element:<QueryClientProvider client={client}><Page loaderData={{userId:'alice',page:list}} params={{id:list.id}}/></QueryClientProvider>}],{initialEntries:[`/me/lists/${list.id}`]});render(<RouterProvider router={router}/>);return screen.getByRole('region',{name:m.ui_library_editor_entries()});}
test("removing the sole item on the final page clamps the editor back to the preceding page",()=>{
 const entries=view();fireEvent.click(within(entries).getByRole('button',{name:m.chart_next()}));expect(within(entries).getAllByRole('listitem')).toHaveLength(1);
 fireEvent.click(within(entries).getByRole('button',{name:m.library_remove()}));expect(within(entries).getAllByRole('listitem')).toHaveLength(20);
 expect(within(entries).getByText(m.ui_library_editor_page({page:'1',pages:'1'}))).toBeTruthy();
});
test("invalid and duplicate numbers are explained while unicode counts and unpublished status stay accurate",()=>{
 const entries=view(1),number=within(entries).getByRole('textbox',{name:m.library_add_number()});
 for(const value of ['0','01','9223372036854775808']){fireEvent.change(number,{target:{value}});fireEvent.click(within(entries).getByRole('button',{name:m.library_add()}));expect(within(entries).getByRole('alert').textContent).toBe(m.ui_library_invalid_number());}
 fireEvent.change(number,{target:{value:'1'}});fireEvent.click(within(entries).getByRole('button',{name:m.library_add()}));expect(within(entries).getByRole('alert').textContent).toBe(m.ui_library_duplicate_number({id:'1'}));
 fireEvent.change(screen.getByRole('textbox',{name:m.library_name()}),{target:{value:'😀'.repeat(60)}});expect(screen.getByText(m.ui_library_character_count({count:'60',limit:'60'}))).toBeTruthy();
 expect((screen.getByRole('button',{name:m.library_save_private()}) as HTMLButtonElement).disabled).toBe(false);expect(screen.queryByRole('link',{name:m.library_view_public()})).toBeNull();
});
