import { readRouteSlugs } from "@/lib/catalog";
import {
  assertValidIndexNowConfig,
  buildIndexNowPayload,
  buildIndexNowUrlList,
} from "@/lib/indexnow";

const endpoint = process.env.INDEXNOW_ENDPOINT ?? "https://api.indexnow.org/indexnow";
const rawSiteUrl = process.env.INDEXNOW_SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
const rawKey = process.env.INDEXNOW_KEY ?? "";

async function main() {
  const { siteUrl, key } = assertValidIndexNowConfig({
    siteUrl: rawSiteUrl,
    key: rawKey,
  });

  const slugs = await readRouteSlugs();
  const urlList = buildIndexNowUrlList(siteUrl, slugs);
  const payload = buildIndexNowPayload({ siteUrl, key, urlList });

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
