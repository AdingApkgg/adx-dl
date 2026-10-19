import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {act,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,test,vi} from 'vitest';
const mock=vi.hoisted(()=>({activate:vi.fn(),onChange:null as null|(()=>void),snapshot:{scope:'a',jobs:[],history:[],persistent:true,busy:false,failure:null}}));
vi.mock('@/client/downloads/store',()=>({DownloadStore:class{getSnapshot=()=>mock.snapshot;getServerSnapshot=this.getSnapshot;subscribe=()=>()=>{};activate=mock.activate;connect=(fn:()=>void)=>{mock.onChange=fn;return()=>{};};}}));
import {DownloadProvider,useDownloads} from '@/client/downloads/provider';
function State(){return <p data-testid="scope">{useDownloads()?.snapshot.scope??'suspended'}</p>;}
afterEach(()=>vi.unstubAllGlobals());
test('failed identity revalidation keeps stale account downloads suspended',async()=>{mock.activate.mockClear();vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:{message:'offline'}},{status:503})));const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:30000}}});client.setQueryData(['me'],{id:'a',status:'active'});render(<QueryClientProvider client={client}><DownloadProvider><State/></DownloadProvider></QueryClientProvider>);await waitFor(()=>expect(mock.activate).toHaveBeenCalledOnce());await act(async()=>{mock.onChange!();});await waitFor(()=>expect(client.getQueryState(['me'])?.fetchStatus).toBe('idle'));expect(screen.getByTestId('scope').textContent).toBe('suspended');expect(mock.activate).toHaveBeenCalledTimes(1);});
