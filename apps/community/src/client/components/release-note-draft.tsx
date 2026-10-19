import {Alert} from "@astrodx/ui/components/alert";
import {Button} from "@astrodx/ui/components/button";
import {useEffect,useRef,useState} from "react";
import {m} from "@/paraglide/messages.js";
import {getLocale} from "@/paraglide/runtime.js";
import {ApiError} from "@/shared/api-client";
import type {ChartDto,ChartVersionDto} from "@/shared/charts";
import {releaseNoteDraft} from "../author/release-note";
import {compareFingerprints} from "../author/compare";
import type {AuthorAnalysis} from "../author/use-analysis";
import {chartsApi} from "../queries/charts";
import {getBrowserApi} from "../lib/browser";
import {chartErrorMessage} from "../lib/chart-errors";
export function ReleaseNoteDraft({chart,left,right,analysis,onSaved}:{chart:ChartDto;left?:ChartVersionDto;right:ChartVersionDto;analysis:AuthorAnalysis|null;onSaved:(chart:ChartDto)=>Promise<void>}){
 const [text,setText]=useState(right.releaseNote),[base,setBase]=useState({revision:chart.revision,text:right.releaseNote}),[conflict,setConflict]=useState<ChartDto|null>(null),[pending,setPending]=useState(false),[error,setError]=useState<unknown>(),epoch=useRef(0),active=useRef<AbortController|null>(null);
 const dirty=text!==base.text;
 useEffect(()=>()=>{++epoch.current;active.current?.abort();},[]);
 useEffect(()=>{if(!dirty){setText(right.releaseNote);setBase({revision:chart.revision,text:right.releaseNote});setConflict(null);}else if(chart.revision!==base.revision)setConflict(chart);},[chart,right,dirty,base.revision]);
 const generate=()=>{if(right.releaseNote.trim()||text.trim())return;const assets=analysis?.fingerprints.length===2?compareFingerprints(analysis.fingerprints[0],analysis.fingerprints[1]):null;setText(releaseNoteDraft(left,right,assets,analysis?.result.diff??null,getLocale()));};
 async function save(){if(pending||conflict||[...text].length>1000)return;const g=epoch.current,desired=text;setPending(true);setError(undefined);const api=chartsApi(getBrowserApi()),aborter=new AbortController();active.current=aborter;
  const accept=async(updated:ChartDto)=>{if(g!==epoch.current||aborter.signal.aborted)return;const note=updated.versions.find(v=>v.id===right.id)?.releaseNote;if(note===undefined)throw Error("NOT_FOUND");setText(note);setBase({revision:updated.revision,text:note});setConflict(null);await onSaved(updated);};
  try{const updated=await api.patch(chart.id,{expectedRevision:base.revision,releaseNote:{versionId:right.id,text:desired}},aborter.signal);await accept(updated);}
  catch(failure){try{const actual=await api.get(chart.id,aborter.signal);if(g!==epoch.current||aborter.signal.aborted)return;if(!(failure instanceof ApiError&&failure.status<500)&&actual.versions.find(v=>v.id===right.id)?.releaseNote===desired){await accept(actual);return;}setConflict(actual);await onSaved(actual);}catch{}if(g===epoch.current&&!aborter.signal.aborted)setError(failure);}
  finally{if(active.current===aborter)active.current=null;if(g===epoch.current)setPending(false);}
 }
 return <section className="space-y-3 rounded-lg border p-4"><h2 className="font-semibold">{m.chart_metadata_release_note()} · {m.chart_version({number:String(right.ordinal)})}</h2><p className="text-sm">{m.author_note_hint()}</p><Button variant="outline" disabled={pending||!!right.releaseNote.trim()||!!text.trim()||!analysis} onClick={generate}>{m.author_generate_note()}</Button><label className="block">{m.chart_metadata_release_note()}<textarea className="mt-2 min-h-32 w-full rounded border p-3" value={text} maxLength={2000} disabled={pending} onChange={e=>setText(e.target.value)} /></label><p className="text-xs">{[...text].length} / 1000</p><Button disabled={pending||!dirty||!!conflict||[...text].length>1000} onClick={()=>void save()}>{m.author_save_note()}</Button>{conflict?<section role="alert" className="space-y-2 rounded border p-3"><p>{m.chart_metadata_conflict()}</p><p className="whitespace-pre-wrap break-words">{conflict.versions.find(v=>v.id===right.id)?.releaseNote??m.author_missing()}</p><Button variant="outline" disabled={pending||!conflict.versions.some(v=>v.id===right.id)} onClick={()=>{const note=conflict.versions.find(v=>v.id===right.id)!.releaseNote;setBase({revision:conflict.revision,text:note});setConflict(null);setError(undefined);}}>{m.chart_metadata_reviewed()}</Button><Button variant="outline" disabled={pending} onClick={()=>{const note=conflict.versions.find(v=>v.id===right.id)?.releaseNote??"";setText(note);setBase({revision:conflict.revision,text:note});setConflict(null);setError(undefined);}}>{m.chart_metadata_discard()}</Button></section>:null}{error?<Alert variant="destructive">{chartErrorMessage(error)}</Alert>:null}</section>;
}
