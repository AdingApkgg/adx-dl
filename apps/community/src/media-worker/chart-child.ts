import { CHART_IMPORT_ERROR_CODES, type ChartPackageInspection } from "@/shared/charts";
import { inspectChartPackage } from "../server/charts/package-validation";
import { ChartImportError } from "../server/charts/errors";
import sharp from "sharp";
import { CHART_SHARP_VERSION, CHART_VIPS_VERSION } from "../server/charts/recipe";
import { StorageError } from "../server/storage/errors";
import { withNativeSlot } from "./native-slot";
import { readFile, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { validateChartPreviewManifest, readChartArtifactManifest, chartManifestBytes } from "../server/charts/artifact";

/** No source contents on stdout/stderr; a bounded sidecar carries only validated summary/manifest. */
export async function processChart(inputPath: string, outputPath: string, signal?: AbortSignal,
  onChildState?: (state: "started" | "reaped") => void): Promise<ChartPackageInspection> {
  assertChartRuntime();
  return withNativeSlot(async signal => {
    let child: ReturnType<typeof Bun.spawn> | undefined;
    let timedOut = false;
    let success = false;
    const metadata = `${outputPath}.json`;
    const kill = () => child?.kill("SIGKILL");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      child = Bun.spawn({cmd:[process.execPath,fileURLToPath(new URL("./chart-child.ts",import.meta.url)),inputPath,outputPath],stdin:"ignore",stdout:"ignore",stderr:"ignore"});
      onChildState?.("started");
      timer = setTimeout(()=>{timedOut=true;kill();},30_000);
      signal.addEventListener("abort",kill,{once:true});
      if(signal.aborted) kill();
      const code = await child.exited;
      onChildState?.("reaped");
      signal.throwIfAborted();
      if(timedOut) throw new StorageError(503,"PROCESSING_FAILED");
      if(code !== 0) throw new StorageError(code >= 20 && code < 20+CHART_IMPORT_ERROR_CODES.length ? 422 : 503,
        CHART_IMPORT_ERROR_CODES[code-20] ?? "PROCESSING_FAILED");
      if((await stat(metadata)).size > 65_536) throw new StorageError(503,"STORAGE_INCONSISTENT");
      const result = JSON.parse(await readFile(metadata,"utf8")) as ChartPackageInspection;
      validateChartPreviewManifest(result.manifest);
      const encoded = await readChartArtifactManifest(outputPath);
      if(!chartManifestBytes(encoded.manifest).equals(chartManifestBytes(result.manifest)) ||
        JSON.stringify(result.summary) !== JSON.stringify(result.manifest.summary))
        throw new StorageError(503,"STORAGE_INCONSISTENT");
      const size = (await stat(outputPath)).size;
      if(size < 1 || size > 50_331_648 || result.artifact.size !== size || result.artifact.path !== outputPath)
        throw new StorageError(503,"STORAGE_INCONSISTENT");
      const hash = createHash("sha256");
      for await(const chunk of Bun.file(outputPath).stream()) { signal.throwIfAborted(); hash.update(chunk); }
      if(hash.digest("hex") !== result.artifact.sha256) throw new StorageError(503,"STORAGE_INCONSISTENT");
      success = true;
      return result;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort",kill);
      if(child && child.exitCode === null) { kill(); await child.exited; }
      await rm(metadata,{force:true});
      if(!success) await rm(outputPath,{force:true});
    }
  },signal);
}
function assertChartRuntime() {
  if(sharp.versions.sharp !== CHART_SHARP_VERSION || sharp.versions.vips !== CHART_VIPS_VERSION)
    throw new StorageError(503,"STORAGE_INCONSISTENT");
}

if(import.meta.main) {
  try {
    assertChartRuntime();
    const result = await inspectChartPackage(process.argv[2],process.argv[3]);
    await Bun.write(`${process.argv[3]}.json`,JSON.stringify(result));
  } catch(error) {
    const index = error instanceof ChartImportError ? CHART_IMPORT_ERROR_CODES.indexOf(error.code) : -1;
    process.exit(index < 0 ? 1 : 20+index);
  }
}
