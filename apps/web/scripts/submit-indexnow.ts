import { spawnSync } from "node:child_process";
import path from "node:path";

import { readCatalogEntries } from "@/lib/catalog";
import {
  getOptionalIndexNowConfig,
  buildIndexNowPayload,
  buildIndexNowUrlList,
  diffChangedSlugs,
  resolveIndexNowKey,
  type IndexNowCatalogEntry,
} from "@/lib/indexnow";
import { entrySlug } from "@/lib/route-slug";
import { resolveSiteUrl } from "@/lib/site-url";

const endpoint = process.env.INDEXNOW_ENDPOINT ?? "https://api.indexnow.org/indexnow";
const siteUrl = resolveSiteUrl(process.env.INDEXNOW_SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL);
const key = resolveIndexNowKey(process.env.INDEXNOW_KEY);

// The commit the live site was last built from — github.event.before in CI.
// Absent (workflow_dispatch, a branch's first push) means we can't tell what changed.
const baseRef = process.env.INDEXNOW_BASE_REF?.trim();

const repoRoot = path.resolve(process.cwd(), "..", "..");
const catalogRepoPath = "data/catalog/index.json";

function git(args: string[]) {
  return spawnSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf-8",
    // The catalog is ~4MB and grows; the 1MB default would truncate `git show`
    // into an ENOBUFS failure and silently downgrade us to a full submission.
    maxBuffer: 64 * 1024 * 1024,
  });
}

// The catalog as it stood at `ref`. CI runs on a blob:none partial clone, so this
// lazily fetches just the one blob it needs. Returns null when the ref is
// unreachable — a force-push, a shallow fetch, or the all-zeros SHA GitHub sends
// for a branch's first push.
function readCatalogEntriesAtRef(ref: string): IndexNowCatalogEntry[] | null {
  const result = git(["show", `${ref}:${catalogRepoPath}`]);

  if (result.status !== 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(result.stdout);
    return Array.isArray(parsed?.entries) ? parsed.entries : null;
  } catch {
    return null;
  }
}

// Static pages (home, /charts, /versions, …) are assembled from app code as well
// as from the catalog, so a front-end-only deploy still changes what they render.
function hasFrontendChanges(ref: string): boolean {
  const result = git(["diff", "--quiet", ref, "HEAD", "--", "apps/web/src", "apps/web/public"]);
  // 0 = identical, 1 = differs, anything else = git itself failed — assume changed.
  return result.status !== 0;
}

async function main() {
  const config = getOptionalIndexNowConfig({
    siteUrl,
    key,
  });

  if (!config) {
    console.log("Skipping IndexNow submission because INDEXNOW_SITE_URL or INDEXNOW_KEY is not set");
    return;
  }

  const entries = await readCatalogEntries();
  const previousEntries = baseRef ? readCatalogEntriesAtRef(baseRef) : null;

  let urlList: string[];

  if (previousEntries) {
    const changedSlugs = diffChangedSlugs(previousEntries, entries);
    const frontendChanged = hasFrontendChanges(baseRef!);

    if (changedSlugs.length === 0 && !frontendChanged) {
      console.log(`No chart or page changes since ${baseRef} — skipping IndexNow submission.`);
      return;
    }

    console.log(
      `Changed since ${baseRef}: ${changedSlugs.length} chart(s), ` +
        `front-end ${frontendChanged ? "changed" : "unchanged"}`
    );
    // Changed charts always ship alongside the static pages: the browse and
    // version listings re-render whenever any chart changes.
    urlList = buildIndexNowUrlList(config.siteUrl, changedSlugs);
  } else {
    // Submitting all ~1600 charts is exactly the "batch mode" Bing Webmaster Tools
    // warns about, so it stays a fallback for when the diff base is really missing.
    urlList = buildIndexNowUrlList(
      config.siteUrl,
      entries.map((entry) => entrySlug(entry))
    );
    console.warn(
      baseRef
        ? `⚠️ Could not read the catalog at ${baseRef} — falling back to a full submission.`
        : "⚠️ INDEXNOW_BASE_REF is not set — falling back to a full submission."
    );
  }

  const payload = buildIndexNowPayload({ siteUrl: config.siteUrl, key: config.key, urlList });

  console.log(`Submitting ${payload.urlList.length} URLs to ${endpoint}`);
  console.log(`IndexNow host: ${payload.host}`);
  console.log(`IndexNow keyLocation: ${payload.keyLocation}`);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();
  console.log(`IndexNow response: ${response.status} ${response.statusText}`);
  console.log(responseText);

  if (!response.ok) {
    // IndexNow is a best-effort SEO ping; the site is already published, so a
    // rejected submission must not fail the build. New sites commonly return
    // 403 "SiteVerificationNotCompleted" until IndexNow verifies the key file —
    // later deploys succeed once verification completes.
    console.warn(
      `⚠️ IndexNow did not accept the submission (status ${response.status}). ` +
        `Non-fatal — search engines will be re-pinged on the next deploy.`
    );
  }
}

main().catch((error) => {
  // Never fail the deploy over a best-effort IndexNow ping.
  console.warn("⚠️ IndexNow submission errored (non-fatal):", error);
});
