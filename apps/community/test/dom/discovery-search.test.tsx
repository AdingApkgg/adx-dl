import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {createMemoryRouter,RouterProvider} from 'react-router';
import {afterEach,expect,test,vi} from 'vitest';
import {DiscoverySearch} from '@/client/components/discovery-search';
import {m} from '@/paraglide/messages.js';
import {createApiClient} from '@/shared/api-client';
import * as browser from '@/client/lib/browser';
afterEach(()=>vi.restoreAllMocks());
test('composition does not request suggestions and stale aborted requests cannot replace a later query',async()=>{
 const requests:string[]=[];
 const fetcher=vi.fn(async(input:RequestInfo|URL)=>{const url=new URL(String(input),'http://localhost');requests.push(url.searchParams.get('q')??'');return new Response('[]',{headers:{'content-type':'application/json'}});});
 vi.spyOn(browser,'getRenderApi').mockReturnValue(createApiClient('http://localhost',{fetch:fetcher as unknown as typeof fetch}));
 render(<RouterProvider router={createMemoryRouter([{path:'/',element:<DiscoverySearch/>}])}/>);
 const input=screen.getByRole('combobox',{name:m.discovery_search_label()});
 fireEvent.focus(input);fireEvent.compositionStart(input);fireEvent.change(input,{target:{value:'日本語'}});await new Promise(r=>setTimeout(r,180));expect(requests).toEqual([]);
 fireEvent.compositionEnd(input,{data:'語'});await waitFor(()=>expect(requests).toEqual(['日本語']));
 fireEvent.keyDown(input,{key:'Escape'});expect(input.getAttribute('aria-expanded')).toBe('false');
});

 test('Escape and page suspension invalidate late suggestion responses',async()=>{
 const pending:((r:Response)=>void)[]=[];
 const fetcher=vi.fn(()=>new Promise<Response>(resolve=>pending.push(resolve)));
 vi.spyOn(browser,'getRenderApi').mockReturnValue(createApiClient('http://localhost',{fetch:fetcher as unknown as typeof fetch}));
 render(<RouterProvider router={createMemoryRouter([{path:'/',element:<DiscoverySearch/>}])}/>);
 const input=screen.getByRole('combobox');fireEvent.focus(input);fireEvent.change(input,{target:{value:'late'}});
 await waitFor(()=>expect(pending).toHaveLength(1));fireEvent.keyDown(input,{key:'Escape'});
 pending[0]!(new Response(JSON.stringify([{type:'charts',publicId:'1',title:'Withdrawn candidate',description:'',url:'/charts/1',updatedAt:new Date().toISOString(),reason:null}]),{headers:{'content-type':'application/json'}}));
 await new Promise(r=>setTimeout(r,30));expect(screen.queryByRole('listbox')).toBeNull();
 fireEvent.change(input,{target:{value:'later'}});await waitFor(()=>expect(pending).toHaveLength(2));window.dispatchEvent(new Event('pagehide'));
 pending[1]!(new Response('[]',{headers:{'content-type':'application/json'}}));await new Promise(r=>setTimeout(r,30));expect(input.getAttribute('aria-expanded')).toBe('false');
 });
