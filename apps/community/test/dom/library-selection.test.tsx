import {QueryClientProvider} from '@tanstack/react-query';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,test,vi} from 'vitest';
import {MemoryRouter} from 'react-router';
import {makeQueryClient} from '@/shared/query-client';
import {LibrarySelectionProvider,ChartSelection,useLibrarySelection} from '@/client/components/library-selection';
import {AddToList} from '@/client/components/library-actions';
import {m} from '@/paraglide/messages.js';
function Count(){const state=useLibrarySelection();return <p data-testid="selected">{state?.ids.join(',')}</p>;}
function view(me:{id:string;status:string}|null){const client=makeQueryClient();client.setQueryData(['me'],me);const result=render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/charts']}><LibrarySelectionProvider><ChartSelection publicId="1"/><ChartSelection publicId="2"/><Count/><AddToList publicIds={['1']}/></LibrarySelectionProvider></MemoryRouter></QueryClientProvider>);return {...result,client};}
afterEach(()=>vi.unstubAllGlobals());
test('account changes and sign-out synchronously hide and clear prior selection',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>Response.json(null)));const {client}=view({id:'a',status:'active'});fireEvent.click(screen.getByRole('checkbox',{name:m.library_select_chart({id:'1'})}));expect(screen.getByTestId('selected').textContent).toBe('1');await act(async()=>{client.setQueryData(['me'],{id:'b',status:'active'});});await waitFor(()=>expect(screen.getByTestId('selected').textContent).toBe(''));await act(async()=>{client.setQueryData(['me'],{id:'a',status:'active'});});expect(screen.getByTestId('selected').textContent).toBe('');});
test('anonymous list action redirects to login without fetching private list data',()=>{const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);view(null);expect(screen.getByRole('link',{name:m.library_add()}).getAttribute('href')).toContain('/login?');expect(fetcher).not.toHaveBeenCalled();});
test('failed list lookup remains a retryable error and never looks like empty success',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:{code:'STORAGE_BUSY',message:'retry'}},{status:503})));view({id:'a',status:'active'});fireEvent.click(screen.getByRole('button',{name:m.library_add(),exact:true}));await screen.findByRole('alert');expect(screen.queryByRole('link',{name:m.library_saved()})).toBeNull();});
