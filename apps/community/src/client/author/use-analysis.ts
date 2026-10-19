import {useEffect,useState} from "react";
import {expectOk} from "@/shared/api-client";
import type {ChartDifficulty} from "@/shared/charts";
import type {VersionFingerprint} from "@/shared/author-workbench";
import {chartsApi,chartAssetUrl} from "../queries/charts";
import {getBrowserApi} from "../lib/browser";
import {runAuthorAnalysis} from "./worker-client";
import type {AnalysisResult} from "./analysis-worker";
export type AuthorAnalysis={sources:string[];fingerprints:VersionFingerprint[];result:AnalysisResult;warning?:string};
export async function readBoundedSource(url:string,signal:AbortSignal){
 const response=await expectOk(await fetch(url,{signal,cache:"no-store",credentials:"same-origin",redirect:"error"}));
 if(Number(response.headers.get("content-length"))>1048576){await response.body?.cancel();throw Error("SOURCE_LIMIT");}
 if(!response.body)throw Error("SOURCE_MISSING");const reader=response.body.getReader(),decoder=new TextDecoder("utf-8",{fatal:true});let size=0,text="";
 try{while(true){const next=await reader.read();signal.throwIfAborted();if(next.done)break;size+=next.value.byteLength;if(size>1048576)throw Error("SOURCE_LIMIT");text+=decoder.decode(next.value,{stream:true});}return text+decoder.decode();}
 finally{await reader.cancel().catch(()=>{});}
}
export function useAuthorAnalysis(account:string|null,chart:string,versions:string[],difficulty:ChartDifficulty){
 const key=JSON.stringify({account,chart,versions,difficulty}),[state,setState]=useState<{key:string;data:AuthorAnalysis|null;error:unknown}>({key,data:null,error:null}),[retry,setRetry]=useState(0);
 useEffect(()=>{const aborter=new AbortController();setState({key,data:null,error:null});if(!account||!versions.length||versions.length>2)return()=>aborter.abort();
  void(async()=>{const api=chartsApi(getBrowserApi()),fingerprints:VersionFingerprint[]=[],sources:string[]=[];
   for(const version of versions){fingerprints.push(await api.fingerprint(chart,version,aborter.signal));sources.push(await readBoundedSource(chartAssetUrl(chart,version,"maidata"),aborter.signal));}
   aborter.signal.throwIfAborted();const identity={account,chart,versions,hashes:fingerprints.map(f=>f.assets.maidata?.sha256??""),difficulty,algorithm:1 as const};
   let result:AnalysisResult,warning:string|undefined;
   try{result=await runAuthorAnalysis({identity,sources},aborter.signal);}
   catch(error){aborter.signal.throwIfAborted();warning=error instanceof Error?error.message:"ANALYSIS_FAILED";result={identity,analyses:sources.map(()=>({algorithm:1,difficulty,statements:[],following:false,diagnostics:[],bpm:[],firstMs:0,noteCount:0,error:"PREVIEW_UNSUPPORTED"})),diff:sources.length===2?{complete:false,hunks:[],reason:"mapping"}:null,sourceSame:sources.length===2&&sources[0]===sources[1]};}
   if(!aborter.signal.aborted)setState({key,data:{sources,fingerprints,result,warning},error:null});
  })().catch(error=>{if(!aborter.signal.aborted)setState({key,data:null,error});});return()=>aborter.abort();
 },[key,retry]);
 return {data:state.key===key?state.data:null,error:state.key===key?state.error:null,retry:()=>setRetry(n=>n+1)};
}
