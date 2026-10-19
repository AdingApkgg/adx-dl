import {sha256} from "@noble/hashes/sha2.js";
import {bytesToHex} from "@noble/hashes/utils.js";
import {analyzeMaidata,type MaidataAnalysis} from "./analysis";
import {compareStatements,type StatementDiff} from "./compare";
import type {ChartDifficulty} from "@/shared/charts";
export type AnalysisIdentity={account:string;chart:string;versions:string[];hashes:string[];difficulty:ChartDifficulty;algorithm:1};
export type AnalysisRequest={identity:AnalysisIdentity;sources:string[]};
export type AnalysisResult={identity:AnalysisIdentity;analyses:MaidataAnalysis[];diff:StatementDiff|null;sourceSame:boolean};
self.onmessage=(event:MessageEvent<AnalysisRequest>)=>{
 const {identity,sources}=event.data;
 try{
  if(sources.length<1||sources.length>2||sources.some(s=>new TextEncoder().encode(s).length>1048576))throw Error("SOURCE_LIMIT");
  if(sources.some((source,i)=>bytesToHex(sha256(new TextEncoder().encode(source)))!==identity.hashes[i]))throw Error("SOURCE_HASH_MISMATCH");
  // Each returned analysis drops its full chart/note/render graph before the next parse.
  const analyses=sources.map(source=>analyzeMaidata(source,identity.difficulty));
  const units=(index:number)=>analyses[index].statements.map(s=>({text:sources[index].slice(s.start,s.end),start:s.start,end:s.end}));
  const diff=analyses.length===2?analyses.some(a=>!a.following||a.error)?{complete:false,hunks:[],reason:"mapping"} as StatementDiff:compareStatements(units(0),units(1)):null;
  const result:AnalysisResult={identity,analyses,diff,sourceSame:sources.length===2&&sources[0]===sources[1]};
  self.postMessage({result});
 }catch{self.postMessage({identity,error:"ANALYSIS_FAILED"});}
};
