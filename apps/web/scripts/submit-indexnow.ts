import { readCanonicalSlugs } from "@/lib/catalog";
import {
  getOptionalIndexNowConfig,
  buildIndexNowPayload,
  buildIndexNowUrlList,
  resolveIndexNowKey,
} from "@/lib/indexnow";
import { resolveSiteUrl } from "@/lib/site-url";

const endpoint = process.env.INDEXNOW_ENDPOINT ?? "https://api.indexnow.org/indexnow";
const siteUrl = resolveSiteUrl(process.env.INDEXNOW_SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL);
const key = resolveIndexNowKey(process.env.INDEXNOW_KEY);

async function main() {
  const config = getOptionalIndexNowConfig({
    siteUrl,
    key,
  });

  if (!config) {
    console.log("Skipping IndexNow submission because INDEXNOW_SITE_URL or INDEXNOW_KEY is not set");
    return;
  }

  const slugs = await readCanonicalSlugs();
  const urlList = buildIndexNowUrlList(config.siteUrl, slugs);
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
