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
 const [text,setText]=useState(right.releaseNote),[pending,setPending]=useState(false),[error,setError]=useState<unknown>(),epoch=useRef(0);
 useEffect(()=>{const g=++epoch.current;setText(right.releaseNote);setError(undefined);return()=>{if(epoch.current===g)++epoch.current;};},[chart.id,right.id]);
 const generate=()=>{if(right.releaseNote.trim()||text.trim())return;const assets=analysis?.fingerprints.length===2?compareFingerprints(analysis.fingerprints[0],analysis.fingerprints[1]):null;setText(releaseNoteDraft(left,right,assets,analysis?.result.diff??null,getLocale()));};
 async function save(){if(pending||[...text].length>1000)return;const g=epoch.current,desired=text;setPending(true);setError(undefined);const api=chartsApi(getBrowserApi());
  try{const updated=await api.patch(chart.id,{expectedRevision:chart.revision,releaseNote:{versionId:right.id,text:desired}});if(g===epoch.current)await onSaved(updated);}
  catch(failure){try{const actual=await api.get(chart.id);if(g!==epoch.current)return;await onSaved(actual);if(!(failure instanceof ApiError&&failure.status<500)&&actual.versions.find(v=>v.id===right.id)?.releaseNote===desired)return;}catch{}if(g===epoch.current)setError(failure);}
  finally{if(g===epoch.current)setPending(false);}
 }
 return <section className="space-y-3 rounded-lg border p-4"><h2 className="font-semibold">{m.chart_metadata_release_note()} · {m.chart_version({number:String(right.ordinal)})}</h2><p className="text-sm">{m.author_note_hint()}</p><Button variant="outline" disabled={pending||!!right.releaseNote.trim()||!!text.trim()||!analysis} onClick={generate}>{m.author_generate_note()}</Button><label className="block">{m.chart_metadata_release_note()}<textarea className="mt-2 min-h-32 w-full rounded border p-3" value={text} maxLength={2000} disabled={pending} onChange={e=>setText(e.target.value)} /></label><p className="text-xs">{[...text].length} / 1000</p><Button disabled={pending||text===right.releaseNote||[...text].length>1000} onClick={()=>void save()}>{m.author_save_note()}</Button>{error?<Alert variant="destructive">{chartErrorMessage(error)}</Alert>:null}</section>;
}
