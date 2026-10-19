import { normalizeChartTags } from "./chart-metadata";
import type { ChartDifficulty } from "./charts";
import { isPublicUserId } from "./user-public-id";
export type PublicChartSearchInput = { q?:string; difficulty?:string;sort?:string;author?:string;tag?:string;tags?:string;levels?:string;designer?:string;minSeconds?:string;maxSeconds?:string;preview?:string };
export type PublicChartFilters = {q:string;difficulty?:ChartDifficulty;sort:"updated"|"published"|"collected"|"title"|"relevance";author?:string;tag?:string;tags?:string[];levels?:string[];designer?:string;minSeconds?:number;maxSeconds?:number;preview?:boolean};
export const PUBLIC_CHART_SEARCH_MAX=120;
const fields=["q","difficulty","sort","author","tag","tags","levels","designer","minSeconds","maxSeconds","preview"] as const;
function list(value:string|undefined,max:number,normalize:(s:string)=>string):string[]|undefined {
 if(!value)return undefined;if(value.length>2048)throw new RangeError("Invalid filters");
 let a:unknown;try{a=JSON.parse(value);}catch{throw new RangeError("Invalid filters");}if(!Array.isArray(a)||a.length>max||a.some(v=>typeof v!=="string"))throw new RangeError("Invalid filters");
 return [...new Set((a as string[]).map(normalize))];
}
export function parsePublicChartFilters(input:PublicChartSearchInput={}):PublicChartFilters {
 if((input.q?.length??0)>240)throw new RangeError("Invalid search");
 const q=(input.q??"").trim();
 if([...q].length>120||/[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(q))throw new RangeError("Invalid search");
 const difficulty=input.difficulty||undefined,author=input.author||undefined,sort=input.sort||"updated";
 if(difficulty!==undefined&&!/^[1-7]$/.test(difficulty)||author!==undefined&&!isPublicUserId(author)||!["updated","published","collected","title","relevance"].includes(sort))throw new RangeError("Invalid filters");
 if(input.tag&&input.tags)throw new RangeError("Conflicting tag filters");
 const tag=input.tag?normalizeChartTags([input.tag])[0]?.key:undefined;
 const tags=list(input.tags,5,v=>normalizeChartTags([v])[0].key);
 const normalize=(v:string)=>{const t=v.normalize("NFKC").trim().replace(/[A-Z]/g,c=>c.toLowerCase());if(!t||[...t].length>120||/[\p{Cc}\uD800-\uDFFF]/u.test(t))throw new RangeError("Invalid filter value");return t;};
 const levels=list(input.levels,8,normalize),designer=input.designer?normalize(input.designer):undefined;
 const seconds=(v:string|undefined)=>{if(v===undefined||v==="")return undefined;if(!/^(0|[1-9]\d{0,3})$/.test(v)||Number(v)>3600)throw new RangeError("Invalid duration");return Number(v);};
 const minSeconds=seconds(input.minSeconds),maxSeconds=seconds(input.maxSeconds);
 if(minSeconds!==undefined&&maxSeconds!==undefined&&minSeconds>maxSeconds||input.preview!==undefined&&input.preview!==""&&input.preview!=="1")throw new RangeError("Invalid filters");
 return {q,sort:sort as PublicChartFilters["sort"],...(difficulty?{difficulty:Number(difficulty) as ChartDifficulty}:{}),...(author?{author}:{}),...(tag?{tag}:{}),...(tags?.length?{tags}:{}),...(levels?.length?{levels}:{}),...(designer?{designer}:{}),...(minSeconds!==undefined?{minSeconds}:{}),...(maxSeconds!==undefined?{maxSeconds}:{}),...(input.preview==="1"?{preview:true}:{})};
}
export function publicChartFiltersFromParams(params:URLSearchParams):PublicChartFilters {
 for(const key of fields)if(params.getAll(key).length>1)throw new RangeError("Duplicate filter");
 const input:PublicChartSearchInput=Object.fromEntries(fields.map(key=>[key,params.get(key)??undefined]));
 for(const [param,field] of [["tagLines","tags"],["levelLines","levels"]] as const){const text=params.get(param);if(text){if(text.length>2048||input[field]||field==="tags"&&input.tag)throw new RangeError("Conflicting filters");input[field]=JSON.stringify(text.split(/\r?\n/).map(t=>t.trim()).filter(Boolean));}}
 for(const [param,field] of [["tag[]","tags"],["level[]","levels"]] as const){const v=params.getAll(param).map(s=>s.trim()).filter(Boolean);if(v.length){if(input[field]||field==="tags"&&input.tag)throw new RangeError("Conflicting filters");input[field]=JSON.stringify(v);}}
 return parsePublicChartFilters(input);
}
export function publicChartSearchParams(filters:PublicChartFilters):URLSearchParams {
 const p=new URLSearchParams();
 for(const key of fields){const v=filters[key as keyof PublicChartFilters];if(v===undefined||v===""||Array.isArray(v)&&!v.length||key==="sort"&&v==="updated")continue;p.set(key,Array.isArray(v)?JSON.stringify(v):typeof v==="boolean"?"1":String(v));}return p;
}
