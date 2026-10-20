import {afterEach,beforeEach,expect,test,vi} from "vitest";
import {act,fireEvent,render,screen,within} from "@testing-library/react";
import {MemoryRouter} from "react-router";
import type {DownloadSnapshot} from "@/client/downloads/store";
import type {DownloadJob} from "@/client/downloads/persistence";
import {downloadJobView,downloadQueueView,canSaveDownloadItem} from "@/client/downloads/presentation";
import Downloads from "@/client/routes/downloads";
import {DownloadAddButton,DownloadDock} from "@/client/components/download-actions";
import {m} from "@/paraglide/messages.js";
const fixture=vi.hoisted(()=>({snapshot:null as unknown as DownloadSnapshot,store:{clear:vi.fn(async()=>{}),pauseAll:vi.fn(),pause:vi.fn(),resume:vi.fn(),cancel:vi.fn(async()=>{}),saveItem:vi.fn(async()=>{}),saveCollection:vi.fn(async()=>{}),saveDirectory:vi.fn(async()=>{}),enqueue:vi.fn(async()=>true)}}));
vi.mock("@/client/downloads/provider",()=>({useDownloads:()=>fixture}));
const job=(id:string,status:DownloadJob['items'][number]['status'],state:DownloadJob['state']):DownloadJob=>({id,scope:"alice",createdAt:Date.parse('2026-10-21T00:00:00Z'),mode:"files",state,items:[{publicId:id,versionId:"12345678-1234-4234-8234-123456789abc",size:100,received:status==='ready'?100:25,sha256:'a'.repeat(64),url:`/api/v1/charts/${id}/download?expectedVersion=12345678-1234-4234-8234-123456789abc`,status}]});
beforeEach(()=>{vi.clearAllMocks();fixture.snapshot={scope:'alice',jobs:[],history:[],persistent:true,busy:false,failure:null};});
afterEach(()=>vi.unstubAllGlobals());
test("mixed download stages expose honest counts and only relevant pause, retry and save controls",()=>{
 fixture.snapshot.jobs=[job('1','fetching','running'),job('2','ready','ready'),job('3','failed','ready')];
 expect(downloadQueueView(fixture.snapshot.jobs)).toMatchObject({active:1,ready:1,attention:1});
 render(<MemoryRouter><Downloads/></MemoryRouter>);
 const articles=within(screen.getByRole('region',{name:m.ui_download_queue()})).getAllByRole('article');
 expect(within(articles[0]!).getByRole('button',{name:m.download_pause()})).toBeTruthy();
 expect(within(articles[1]!).queryByRole('button',{name:m.download_pause()})).toBeNull();
 expect(within(articles[1]!).queryByRole('button',{name:m.download_resume()})).toBeNull();
 expect((within(articles[1]!).getByRole('button',{name:m.download_save_original()}) as HTMLButtonElement).disabled).toBe(false);
 fireEvent.click(within(articles[2]!).getByRole('button',{name:m.download_resume()}));expect(fixture.store.resume).toHaveBeenCalledWith('3');
});
test("budget and nonpersistent native save fallbacks stay usable without pretending a file is verified",()=>{
 const failed=job('1','failed','failed');expect(canSaveDownloadItem(failed.items[0]!,failed,false,false)).toBe(true);
 expect(canSaveDownloadItem(failed.items[0]!,failed,true,true)).toBe(false);
 failed.warning='budget';expect(canSaveDownloadItem(failed.items[0]!,failed,true,true)).toBe(true);
 expect(downloadJobView(failed).allReady).toBe(false);
 const mixed=job('2','changed','ready');mixed.items.push({...job('3','ready','ready').items[0]!});
 expect(downloadJobView(mixed)).toMatchObject({readyCount:1,allReady:false,needsAttention:true,canResume:true});
});
test("clearing device records requires confirmation and history describes a save request",()=>{
 fixture.snapshot.history=[{id:'history',scope:'alice',finishedAt:Date.parse('2026-10-21T00:00:00Z'),publicIds:['1','2']}];render(<MemoryRouter><Downloads/></MemoryRouter>);
 expect(screen.getByText(m.ui_download_history_hint())).toBeTruthy();expect(document.querySelector('time')?.dateTime).toBe('2026-10-21T00:00:00.000Z');
 fireEvent.click(screen.getByRole('button',{name:m.download_clear()}));expect(fixture.store.clear).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:m.ui_download_keep()}));expect(fixture.store.clear).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:m.download_clear()}));fireEvent.click(screen.getByRole('button',{name:m.ui_download_clear_confirm()}));expect(fixture.store.clear).toHaveBeenCalledOnce();
});
test("download dock exposes overall progress on other pages and is absent on the download page",()=>{
 fixture.snapshot.jobs=[job('1','fetching','running')];const result=render(<MemoryRouter initialEntries={['/charts']}><DownloadDock/></MemoryRouter>);
 expect(screen.getByRole('progressbar',{name:m.ui_download_overall_progress()}).getAttribute('value')).toBe('25');
 result.unmount();render(<MemoryRouter initialEntries={['/ja/downloads']}><DownloadDock/></MemoryRouter>);expect(screen.queryByRole('complementary')).toBeNull();
});
test("download plan can be dismissed without starting a task and oversized selections stay blocked",async()=>{
 const plan=job('1','queued','queued').items[0]!,{status:_status,received:_received,...item}=plan;
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({items:[item]})));
 const result=render(<MemoryRouter><DownloadAddButton publicIds={['1']}/></MemoryRouter>);
 fireEvent.click(screen.getByRole('button',{name:m.download_add()}));await screen.findByRole('button',{name:m.download_confirm()});fireEvent.click(screen.getByRole('button',{name:m.ui_download_cancel_plan()}));
 expect(screen.queryByRole('button',{name:m.download_confirm()})).toBeNull();expect(fixture.store.enqueue).not.toHaveBeenCalled();
 result.unmount();render(<MemoryRouter><DownloadAddButton publicIds={Array.from({length:51},(_,i)=>String(i+1))}/></MemoryRouter>);
 expect((screen.getByRole('button',{name:m.download_add()}) as HTMLButtonElement).disabled).toBe(true);expect(screen.getByText(m.download_batch_limit())).toBeTruthy();
});

test("a long directory save keeps the single-task cancel action available",async()=>{
 fixture.snapshot.jobs=[job('1','ready','ready')];let finish!:()=>void;const pending=new Promise<void>(resolve=>{finish=resolve;});
 fixture.store.saveDirectory.mockImplementationOnce(()=>pending);vi.stubGlobal('showDirectoryPicker',vi.fn(async()=>({})));
 render(<MemoryRouter><Downloads/></MemoryRouter>);
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:m.download_save_directory()}));});
 expect(fixture.store.saveDirectory).toHaveBeenCalledOnce();expect(screen.getByText(m.ui_download_saving())).toBeTruthy();
 const cancel=screen.getByRole('button',{name:m.download_cancel()}) as HTMLButtonElement;expect(cancel.disabled).toBe(false);
 await act(async()=>{fireEvent.click(cancel);});expect(fixture.store.cancel).toHaveBeenCalledWith('1');await act(async()=>finish());
});
