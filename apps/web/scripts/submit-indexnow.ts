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
    throw new Error(`IndexNow submission failed with status ${response.status}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
