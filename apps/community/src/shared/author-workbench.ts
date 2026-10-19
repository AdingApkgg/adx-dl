import type { ChartAssetRole, ChartListItemDto, ChartsPageDto } from "./charts";
export type WorkbenchFilters={q?:string;status?:string;changed?:boolean;warnings?:boolean;pending?:boolean;cursor?:string};
export type WorkbenchItem=ChartListItemDto & {versionCount:number;currentOrdinal:number;warningCount:number;changed:boolean;moderated:boolean};
export type WorkbenchPage={items:WorkbenchItem[];nextCursor:string|null;counts:{total:number;private:number;published:number;changed:number;warnings:number;pending:number;hidden:number};
 targets:{id:string;title:string;revision:number;versionCount:number}[];usage:ChartsPageDto["usage"]};
export type VersionFingerprint={versionId:string;source:{sha256:string;size:number};assets:Partial<Record<ChartAssetRole,{sha256:string;size:number;mime:string}>>};
export type SourceBinding={state:"bound";chartId:string;versionId:string}|{state:"unbound"}|{state:"unavailable"};
