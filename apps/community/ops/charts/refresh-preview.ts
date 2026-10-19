import { readFile, writeFile, lstat } from "node:fs/promises";
import { createDb } from "../../src/server/db/client";
import { getSender, stopSender } from "../../src/server/jobs/boss";
import { createStorageContext } from "../../src/server/storage/runtime";
import { createLogger } from "../../src/shared/log";
import { planPreviewRefresh, applyPreviewRefresh, type PreviewRefreshPlan } from "../../src/server/charts/preview-refresh";

// Plan inside the media container; apply inside web so upload admission uses its registered policy.
// Plan files stay on the remote host, mode 0600.
async function main() {
let handle: ReturnType<typeof createDb> | undefined;
try {
const [mode, argument, output] = process.argv.slice(2);
if (!process.env.DATABASE_URL || !["plan", "apply"].includes(mode) || !argument || (mode === "plan" && !output)) throw new Error("PREVIEW_REFRESH_ARGUMENTS");
handle = createDb(process.env.DATABASE_URL, { onPoolError: () => {} });
const { db } = handle;
const ctx = createStorageContext({ db, boss: () => getSender(process.env.DATABASE_URL!, () => {}), log: createLogger(() => {}), role: mode === "plan" ? "media" : "web" });
  if (mode === "plan") {
    const plan = await planPreviewRefresh(ctx, argument);
    await writeFile(output, JSON.stringify(plan), { mode: 0o600, flag: "wx" });
    console.log(JSON.stringify({ status: "planned", digest: plan.digest, versionId: plan.snapshot.versionId,
      sourceSha256: plan.snapshot.sourceSha256, outputSha256: plan.artifact.sha256, difficulties: plan.artifact.manifest.summary.difficulties, warnings: plan.artifact.manifest.summary.warnings }));
  } else {
    const info = await lstat(argument);
    if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > 131072 || (process.getuid && info.uid !== process.getuid())) throw new Error("PREVIEW_REFRESH_PLAN_NOT_PRIVATE");
    const plan = JSON.parse(await readFile(argument, "utf8")) as PreviewRefreshPlan;
    console.log(JSON.stringify(await applyPreviewRefresh(ctx, plan)));
  }
} finally { await stopSender(); await handle?.pool.end(); }
}
void main().catch(() => {
  // Operator-visible output must never contain a DSN, source name, SQL parameter or nested driver cause.
  console.error(JSON.stringify({ status: "failed", code: "PREVIEW_REFRESH_FAILED" }));
  process.exitCode = 1;
});
