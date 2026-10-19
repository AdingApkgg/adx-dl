import type {AnalysisRequest,AnalysisResult} from "./analysis-worker";
let active:(()=>void)|null=null;
export function runAuthorAnalysis(input:AnalysisRequest,signal:AbortSignal):Promise<AnalysisResult>{
 active?.();return new Promise((resolve,reject)=>{
  if(signal.aborted){reject(new DOMException("Aborted","AbortError"));return;}
  const worker=new Worker(new URL("./analysis-worker.ts",import.meta.url),{type:"module"});let done=false;
  const finish=(error?:unknown,result?:AnalysisResult)=>{if(done)return;done=true;worker.terminate();clearTimeout(timer);signal.removeEventListener("abort",abort);if(active===abort)active=null;error?reject(error):resolve(result!);};
  const abort=()=>finish(new DOMException("Aborted","AbortError"));active=abort;
  const timer=setTimeout(()=>finish(Error("ANALYSIS_TIMEOUT")),5000);
  signal.addEventListener("abort",abort,{once:true});worker.onerror=()=>finish(Error("ANALYSIS_FAILED"));
  worker.onmessage=(event:MessageEvent<{result?:AnalysisResult;error?:string}>)=>{const result=event.data.result;if(!result||JSON.stringify(result.identity)!==JSON.stringify(input.identity))finish(Error("ANALYSIS_FAILED"));else finish(undefined,result);};
  worker.postMessage(input);
 });
}
