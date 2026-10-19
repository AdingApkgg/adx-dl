import {z} from "zod";
import {libraryPublicId} from "./library";
export const DOWNLOAD_BATCH_LIMIT=50,DOWNLOAD_CACHE_BYTES=128*1024*1024,DOWNLOAD_PENDING_LIMIT=8,DOWNLOAD_HISTORY_LIMIT=8,DOWNLOAD_TTL_MS=24*60*60*1000;
export const downloadPlanInput=z.object({publicIds:z.array(libraryPublicId).min(1).max(DOWNLOAD_BATCH_LIMIT).refine(ids=>new Set(ids).size===ids.length)}).strict();
export const downloadPlanItem=z.object({publicId:libraryPublicId,versionId:z.string().uuid(),size:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),sha256:z.string().regex(/^[a-f0-9]{64}$/),url:z.string()}).strict().refine(i=>i.url===`/api/v1/charts/${i.publicId}/download?expectedVersion=${i.versionId}`);
export type DownloadPlanItem=z.infer<typeof downloadPlanItem>;
export type DownloadPlan={items:DownloadPlanItem[];totalBytes:number};
export type DownloadItemStatus="queued"|"fetching"|"paused"|"ready"|"save_requested"|"written"|"changed"|"unavailable"|"failed"|"cancelled";
export type DownloadItem=DownloadPlanItem&{status:DownloadItemStatus;received:number;failure?:string};
