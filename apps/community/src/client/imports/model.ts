import {z} from "zod";
import type {ChartParts} from "../lib/chart-input";
export const IMPORT_BYTES=256*1024*1024,IMPORT_TTL=24*60*60*1000;
export const importRowSchema=z.object({id:z.uuid(),name:z.string().max(240),size:z.number().int().min(0).max(67108864),rawSize:z.number().int().min(1).max(134217728),createdAt:z.number(),expiresAt:z.number(),
 phase:z.enum(["confirmation","queued","packing","hashing","uploading","processing","ready","saving","saved","uncertain","paused","failed","cancelled"]),progress:z.number().min(0).max(1),target:z.object({id:z.uuid(),revision:z.number().int().positive()}).strict().nullable(),hash:z.string().regex(/^[a-f0-9]{64}$/).optional(),uploadId:z.uuid().optional(),fileId:z.uuid().optional(),failure:z.string().max(120).optional(),result:z.object({chartId:z.uuid(),versionId:z.uuid()}).strict().optional()}).strict();
export type ImportRow=z.infer<typeof importRowSchema>;
export type ImportSelection={file:File}|{folder:File[]}|{parts:ChartParts};
export function selectionInfo(selection:ImportSelection){const files="file" in selection?[selection.file]:"folder" in selection?selection.folder:Object.values(selection.parts).filter((f):f is File=>!!f);return {name:("file" in selection?selection.file.name:"folder" in selection?selection.folder[0]?.webkitRelativePath.split("/")[0]:selection.parts.maidata?.name)??"chart.zip",rawSize:files.reduce((n,f)=>n+f.size,0),size:"file" in selection?selection.file.size:0};}
export function validatePlan(rows:ImportRow[]){
 if(!rows.length||rows.length>10||rows.reduce((n,r)=>n+r.rawSize,0)>IMPORT_BYTES)throw Error("BATCH_LIMIT");
 const hashes=new Set<string>(),targets=new Set<string>();
 for(const row of rows){if(row.rawSize<=0||row.size>67108864)throw Error("BATCH_LIMIT");if(row.hash){const key=`${row.hash}/${row.size}`;if(hashes.has(key))throw Error("DUPLICATE_BYTES");hashes.add(key);}if(row.target){if(targets.has(row.target.id))throw Error("DUPLICATE_TARGET");targets.add(row.target.id);}}
}
export function restorePlan(value:unknown,now=Date.now()):ImportRow[]{
 if(!Array.isArray(value)||value.length>10)return [];
 const rows:ImportRow[]=[];
 for(const raw of value){const parsed=importRowSchema.safeParse(raw);if(!parsed.success||parsed.data.createdAt>now+60000||parsed.data.expiresAt<=now||parsed.data.expiresAt-parsed.data.createdAt>IMPORT_TTL)continue;const row=parsed.data;rows.push({...row,phase:row.phase==="cancelled"?"cancelled":row.fileId?"uncertain":"paused",progress:0});}
 try{if(rows.length)validatePlan(rows);return rows;}catch{return [];}
}
export const importFailure=(error:unknown)=>{const code=error&&typeof error==="object"&&"code" in error?String(error.code):error instanceof Error?error.message:"IMPORT_FAILED";return /^[A-Z_]{1,80}$/.test(code)?code:"IMPORT_FAILED";};
