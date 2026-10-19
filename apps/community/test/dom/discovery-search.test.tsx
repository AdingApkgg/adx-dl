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
 vi.spyOn(browser,'getRenderApi').mockReturnValue(createApiClient('http://localhost',{fetch:fetcher as typeof fetch}));
 render(<RouterProvider router={createMemoryRouter([{path:'/',element:<DiscoverySearch/>}])}/>);
 const input=screen.getByRole('combobox',{name:m.discovery_search_label()});
 fireEvent.focus(input);fireEvent.compositionStart(input);fireEvent.change(input,{target:{value:'日本語'}});await new Promise(r=>setTimeout(r,180));expect(requests).toEqual([]);
 fireEvent.compositionEnd(input,{data:'語'});await waitFor(()=>expect(requests).toEqual(['日本語']));
 fireEvent.keyDown(input,{key:'Escape'});expect(input.getAttribute('aria-expanded')).toBe('false');
});
