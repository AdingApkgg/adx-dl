import {normalizeSearchText,searchTerms} from './discovery-search';
/** Map normalized matches to original grapheme boundaries; the UI renders text nodes only. */
export function searchHighlights(text:string,query:string):{start:number;end:number}[]{
 const terms=searchTerms(query);if(!terms.length)return [];
 const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter(undefined,{granularity:'grapheme'}):null;
 const segments=segmenter?[...segmenter.segment(text)].map(s=>({segment:s.segment,index:s.index})):Array.from(text).reduce<{segment:string;index:number}[]>((all,segment)=>{all.push({segment,index:all.length?all.at(-1)!.index+all.at(-1)!.segment.length:0});return all;},[]);
 let key='';const map:{start:number;end:number}[]=[];
 for(const s of segments){const n=s.segment.normalize('NFKC').replace(/[A-Z]/g,c=>c.toLowerCase());for(let i=0;i<n.length;i++){const c=/\s/u.test(n[i])?' ':n[i];if(c===' '&&(!key||key.endsWith(' '))){if(map.length)map[map.length-1].end=s.index+s.segment.length;continue;}key+=c;map.push({start:s.index,end:s.index+s.segment.length});}}
 const ranges:{start:number;end:number}[]=[];
 for(const term of terms){let from=0;while(from<key.length){const at=key.indexOf(term,from);if(at<0)break;ranges.push({start:map[at].start,end:map[at+term.length-1].end});from=at+Math.max(1,term.length);}}
 ranges.sort((a,b)=>a.start-b.start||a.end-b.end);const merged:typeof ranges=[];
 for(const r of ranges){const previous=merged.at(-1);if(previous&&r.start<=previous.end)previous.end=Math.max(previous.end,r.end);else merged.push({...r});}return merged;
}
