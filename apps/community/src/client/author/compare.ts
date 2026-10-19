import type {VersionFingerprint} from "@/shared/author-workbench";
export type StatementUnit={text:string;start:number;end:number};
export type StatementHunk={leftStart:number;leftEnd:number;rightStart:number;rightEnd:number};
export type StatementDiff={complete:boolean;hunks:StatementHunk[];reason?:"units"|"hunks"|"time"|"mapping"};
/** Patience anchors partition exact replacement ranges. This is a textual diff, not semantic equivalence. */
export function compareStatements(left:StatementUnit[],right:StatementUnit[],options:{maxHunks?:number;now?:()=>number}={}):StatementDiff{
 const now=options.now??(()=>performance.now()),start=now(),hunks:StatementHunk[]=[];
 const fail=(reason:StatementDiff["reason"]):StatementDiff=>({complete:false,hunks:[],reason});
 if(left.length>20000||right.length>20000)return fail("units");
 const check=()=>{if(now()-start>5000)throw Error("time");};
 try{
  const l=new Map<string,number>(),r=new Map<string,number>();
  left.forEach((unit,i)=>{l.set(unit.text,l.has(unit.text)?-1:i);if(i%256===0)check();});right.forEach((unit,i)=>{r.set(unit.text,r.has(unit.text)?-1:i);if(i%256===0)check();});
  const pairs:{l:number;r:number;previous:number}[]=[],tails:number[]=[];
  for(let i=0;i<left.length;i++){if(i%256===0)check();const rightIndex=r.get(left[i].text);if(l.get(left[i].text)!==i||rightIndex===undefined||rightIndex<0)continue;
   let low=0,high=tails.length;while(low<high){const mid=(low+high)>>>1;if(pairs[tails[mid]].r<rightIndex)low=mid+1;else high=mid;}
   pairs.push({l:i,r:rightIndex,previous:low?tails[low-1]:-1});tails[low]=pairs.length-1;
  }
  const anchors:{l:number;r:number}[]=[];let at=tails.at(-1)??-1;while(at>=0){anchors.push(pairs[at]);at=pairs[at].previous;}anchors.reverse();anchors.push({l:left.length,r:right.length});
  let li=0,ri=0;
  for(const anchor of anchors){check();let le=anchor.l,re=anchor.r;
   while(li<le&&ri<re&&left[li].text===right[ri].text){li++;ri++;if(li%256===0)check();}
   while(le>li&&re>ri&&left[le-1].text===right[re-1].text){le--;re--;if(le%256===0)check();}
   if(li<le||ri<re){if(hunks.length>=(options.maxHunks??1000))return fail("hunks");hunks.push({leftStart:li,leftEnd:le,rightStart:ri,rightEnd:re});}
   li=anchor.l+1;ri=anchor.r+1;
  }
  check();return {complete:true,hunks};
 }catch{return fail("time");}
}
export function compareFingerprints(left:VersionFingerprint,right:VersionFingerprint){
 const same=(a:{sha256:string;size:number}|undefined,b:{sha256:string;size:number}|undefined)=>!a&&!b||!!a&&!!b&&a.sha256===b.sha256&&a.size===b.size;
 const roles=(["maidata","audio","cover"] as const).map(role=>({role,same:same(left.assets[role],right.assets[role]),left:left.assets[role]??null,right:right.assets[role]??null}));
 return {archiveSame:same(left.source,right.source),previewSame:roles.every(r=>r.same),roles};
}
