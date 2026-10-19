import {searchHighlights} from '@/shared/search-highlights';
export function SearchText({text,query=''}:{text:string;query?:string}){let ranges:ReturnType<typeof searchHighlights>;try{ranges=searchHighlights(text,query);}catch{return <>{text}</>;}
 let at=0;const nodes=[];for(const r of ranges){if(r.start>at)nodes.push(text.slice(at,r.start));nodes.push(<mark key={`${r.start}/${r.end}`} className="rounded bg-primary/15 text-inherit">{text.slice(r.start,r.end)}</mark>);at=r.end;}nodes.push(text.slice(at));return <>{nodes}</>;}
