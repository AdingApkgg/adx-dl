import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import type { StorageContext } from "../storage/contracts";
import type { StoragePurpose } from "@/shared/storage";

export const CHART_PREVIEW_MIME = "application/vnd.astrodx.chart-preview";
// Both images pin these versions; the native child verifies actual runtime versions.
export const CHART_SHARP_VERSION = "0.35.5";
export const CHART_VIPS_VERSION = "8.18.7";
let build: string | undefined;
/** Source-bound import recipe; historical versions keep their recorded build. */
export function currentChartRecipeBuild(): string {
  if (build) return build;
  const parser = fileURLToPath(import.meta.resolve("@lxns-network/maimai-chart-engine/parser"));
  const source = dirname(dirname(dirname(parser)));
  const digest = createHash("sha256");
  const visit = (directory: string, prefix = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name,"en"))) {
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory()) visit(join(directory,entry.name), `${relative}/`);
      else if (entry.isFile() && entry.name.endsWith(".ts"))
        digest.update(relative).update("\0").update(readFileSync(join(directory,entry.name))).update("\0");
    }
  };
  visit(source, "engine/");
  // Alias resolution works in both the source worker and bundled web server;
  // runtime images include these private importer sources beside the build.
  const community = dirname(dirname(fileURLToPath(import.meta.resolve("@/shared/charts.ts"))));
  for (const relative of ["server/charts/artifact.ts", "server/charts/maidata-summary.ts",
    "server/charts/package-validation.ts", "server/charts/errors.ts", "server/charts/upload-rules.ts",
    "shared/charts.ts", "shared/charts-maidata.ts", "media-worker/image-child.ts"]) {
    digest.update(`community/${relative}`).update("\0").update(readFileSync(join(community, relative))).update("\0");
  }
  build = `chart-preview-v1.zip-v1.parser-${digest.digest("hex").slice(0,32)}.sharp-${CHART_SHARP_VERSION}.vips-${CHART_VIPS_VERSION}.jpeg85`;
  return build;
}
export function recipeBuildFor(ctx: StorageContext, purpose: StoragePurpose): string {
  return purpose === "avatar" ? ctx.config.recipeBuild : ctx.config.chartRecipeBuild ?? currentChartRecipeBuild();
}
