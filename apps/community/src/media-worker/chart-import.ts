import type { StorageContext, StorageJobData } from "../server/storage/contracts";
import { claimRecipe, claimRecipeOutput, publishRecipeOutput, releaseRecipeComputation, withProcessingUpload, type RecipeClaim } from "../server/storage/objects";
import { checkStorageDisk } from "../server/storage/usage";
import { rejectUpload } from "../server/storage/uploads";
import { StorageError } from "../server/storage/errors";
import { CHART_IMPORT_ERROR_CODES } from "@/shared/charts";
import { CHART_PREVIEW_MIME, currentChartRecipeBuild, recipeBuildFor } from "../server/charts/recipe";
import { copyVerified } from "./avatar";
import { processChart } from "./chart-child";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { watchProcessingUpload } from "./upload-cancellation";
let importing = false;
const permanent = new Set<string>([...CHART_IMPORT_ERROR_CODES,"FILE_TOO_LARGE","HASH_BLOCKED","UPLOAD_EXPIRED","PURPOSE_NOT_AVAILABLE"]);
export async function handleChartImport(ctx: StorageContext, data: StorageJobData): Promise<void> {
  if(recipeBuildFor(ctx,"chart-source") !== currentChartRecipeBuild()) throw new StorageError(503,"STORAGE_INCONSISTENT");
  if(importing) throw new StorageError(503,"STORAGE_BUSY","STORAGE_BUSY",1);
  importing = true;
  let directory: string | undefined;
  let source: RecipeClaim | null = null;
  let outputClaimStarted = false;
  let cancellation: Awaited<ReturnType<typeof watchProcessingUpload>> | undefined;
  try {
    source = await claimRecipe(ctx,data,"chart-source");
    if(!source || source.recipe.state === "ready") return;
    if(source.blob.size > 67_108_864) throw new StorageError(413,"FILE_TOO_LARGE");
    await checkStorageDisk(ctx);
    directory = await mkdtemp(join(ctx.config.tempDir,"chart-"));
    const upstream = ctx.lifecycle ? AbortSignal.any([ctx.lifecycle.signal,AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000);
    cancellation = await watchProcessingUpload(ctx, data, upstream);
    const signal = cancellation.signal;
    const input = join(directory,"input.zip"), outputPath = join(directory,"preview");
    await copyVerified(ctx,"original",source.blob.key,input,source.blob.size,source.blob.sha256,signal);
    await cancellation.check(); signal.throwIfAborted();
    const result = await processChart(input,outputPath,signal);
    const output = { hash:result.artifact.sha256,size:result.artifact.size,mime:CHART_PREVIEW_MIME,properties:{chartPreview:result.manifest} };
    outputClaimStarted = true;
    const claim = await claimRecipeOutput(ctx,data,source,output);
    if(!claim) { outputClaimStarted = false; return; }
    if(claim.kind === "ready") return;
    const existing = await ctx.driver.head({bucket:"derived",key:claim.object.key,signal});
    if(existing) await copyVerified(ctx,"derived",claim.object.key,join(directory,"recovered"),output.size,output.hash,signal);
    else await ctx.driver.put({bucket:"derived",key:claim.object.key,body:Bun.file(outputPath).stream(),size:output.size,mime:output.mime,sha256:output.hash,signal});
    const head = await ctx.driver.head({bucket:"derived",key:claim.object.key,signal});
    if(!head || head.size !== output.size || head.sha256 !== output.hash || head.mime !== output.mime)
      throw new StorageError(503,"STORAGE_INCONSISTENT");
    if(!(await publishRecipeOutput(ctx,data,source,claim)) && await withProcessingUpload(ctx,data,async()=>true))
      throw new StorageError(503,"STORAGE_BUSY","STORAGE_BUSY",30);
  } catch(error) {
    if(error instanceof StorageError && permanent.has(error.code)) { await rejectUpload(ctx,data,error.code); return; }
    throw error;
  } finally {
    cancellation?.stop();
    try {
      if(directory) await rm(directory,{recursive:true,force:true});
      if(source && !outputClaimStarted) await releaseRecipeComputation(ctx,source);
    }
    finally { importing = false; }
  }
}
