import type { ChartDifficulty, PublicChartDto } from "./charts";
import { parsePublicChartFilters, publicChartFiltersFromParams, type PublicChartFilters } from "./public-chart-search";
export const SEARCH_TYPES = ["charts", "authors", "lists", "topics"] as const;
export type SearchType = typeof SEARCH_TYPES[number];
export type SearchKind = "all" | SearchType;
export function normalizeSearchText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").replace(/[A-Z]/g, c => c.toLowerCase());
}
export function searchTerms(value: string): string[] {
  if (value.length > 240 || [...value].length > 120 || /[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(value)) throw new RangeError("Invalid search");
  const q = normalizeSearchText(value), terms = q ? q.split(" ") : [];
  if (terms.length > 6) throw new RangeError("Too many search terms");
  return terms;
}
export type DiscoveryInput = {type:SearchKind;filters:PublicChartFilters;cursor?:string};
export function parseDiscoveryInput(params:URLSearchParams):DiscoveryInput {
  for (const key of params.keys()) if (!["tag[]","level[]"].includes(key) && params.getAll(key).length !== 1) throw new RangeError("Duplicate search field");
  const type = params.get("type") ?? "all";
  if (type !== "all" && !SEARCH_TYPES.includes(type as SearchType)) throw new RangeError("Invalid search type");
  const filters = publicChartFiltersFromParams(params);
  searchTerms(filters.q);
  if (type !== "all" && type !== "charts" && !["relevance","published","updated"].includes(filters.sort)) throw new RangeError("Invalid search sort");
  const cursor = params.get("cursor") || undefined;
  if (cursor && (cursor.length > 1024 || type === "all")) throw new RangeError("Invalid search cursor");
  return {type:type as SearchKind,filters:params.has("sort")?filters:{...filters,sort:"relevance"},...(cursor?{cursor}:{})};
}
export type SearchReason = {kind:"id"|"title"|"alias"|"author"|"artist"|"designer"|"tag"|"body";label:string};
export type SearchHit = {type:SearchType;publicId:string;title:string;description:string;url:string;updatedAt:string;reason:SearchReason|null;chart?:PublicChartDto;image?:string|null;count?:number};
export type SearchGroup = {status:"ready"|"unavailable";items:SearchHit[];total:number|null;nextCursor:string|null};
export type SearchResult = {type:SearchKind;query:string;groups:Record<SearchType,SearchGroup>;facets:SearchFacets|null};
export type SearchFacets = {tags:{key:string;label:string;count:number}[];levels:{value:string;count:number}[];designers:{value:string;count:number}[]};
export type AuthorSummary = {publicId:string;name:string;bio:string;image:string|null;count:number;updatedAt:string};
export type DirectoryPage<T> = {items:T[];nextCursor:string|null};
export type DiscoveryPage = {collected:SearchGroup;updated:SearchGroup;lists:SearchGroup;tags:{status:"ready"|"unavailable";items:SearchFacets["tags"]};daily:PublicChartDto|null;randomAvailable:boolean};
export type PreviewShare = {difficulty:ChartDifficulty;seconds?:number};
export function parsePreviewShare(params:URLSearchParams):PreviewShare|null {
  const d=params.get('difficulty'),t=params.get('t');
  if(d===null&&t===null)return null;
  if(params.getAll('difficulty').length!==1||params.getAll('t').length>1||!d||!/^[1-7]$/.test(d))throw new RangeError('Invalid preview share');
  if(t!==null&&(!/^(?:0|[1-9]\d{0,3})(?:\.\d{1,3})?$/.test(t)||Number(t)>3600))throw new RangeError('Invalid preview time');
  return {difficulty:Number(d) as ChartDifficulty,...(t!==null?{seconds:Number(t)}:{})};
}
export function previewShareParams(value:PreviewShare):URLSearchParams {
  const p=new URLSearchParams({difficulty:String(value.difficulty),...(value.seconds===undefined?{}:{t:String(Math.round(value.seconds*1000)/1000)})});
  parsePreviewShare(p);return p;
}
