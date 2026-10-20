import type {DownloadItem} from "@/shared/downloads";
import type {DownloadJob} from "./persistence";

export const formatDownloadBytes=(n:number)=>n<1024?`${n} B`:n<1024*1024?`${(n/1024).toFixed(1)} KiB`:`${(n/1024/1024).toFixed(2)} MiB`;

/** Download progress describes received bytes, never a confirmed disk save. */
export function downloadJobView(job:DownloadJob){
 const active=job.state==='queued'||job.state==='running';
 const allReady=job.items.length>0&&job.items.every(i=>i.status==='ready');
 const unfinished=job.items.some(i=>!['save_requested','written','cancelled'].includes(i.status));
 const failed=job.items.some(i=>['changed','unavailable','failed'].includes(i.status));
 const total=job.items.reduce((n,i)=>n+i.size,0);
 const received=job.items.reduce((n,i)=>n+Math.max(0,Math.min(i.size,i.received)),0);
 const stage=allReady?'ready':active?job.state==='running'?'fetching':'queued':failed||job.state==='failed'?'failed':job.state==='cancelled'?'cancelled':'paused';
 return {total,received,allReady,active,readyCount:job.items.filter(i=>i.status==='ready').length,needsAttention:failed||!active&&!allReady&&unfinished,canResume:!active&&!allReady&&unfinished,stage} as const;
}

export function canSaveDownloadItem(item:DownloadItem,job:DownloadJob,persistent:boolean,hasLocks:boolean){
 return item.status==='ready'||job.warning==='budget'||!persistent&&!hasLocks;
}

export function downloadQueueView(jobs:DownloadJob[]){
 const views=jobs.map(downloadJobView);
 return {active:views.filter(v=>v.active).length,ready:views.reduce((n,v)=>n+v.readyCount,0),attention:views.filter(v=>v.needsAttention).length,total:views.reduce((n,v)=>n+v.total,0),received:views.reduce((n,v)=>n+v.received,0)};
}
