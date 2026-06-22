import { prefixedLocales } from "@/lib/i18n";

export type IndexNowPayload = {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
};

const staticPaths = ["/", "/charts", "/versions", "/status", "/links"] as const;

// The IndexNow key is public by protocol design — it is served at
// `/indexnow-<key>.txt` on the site — so it lives in the repo as a default and
// migrates with `git clone`. Override via the INDEXNOW_KEY env var if needed.
const defaultIndexNowKey = "b736ff0ebfd4421d37c455504f5d1178";

export function resolveIndexNowKey(rawKey?: string | null): string {
  const trimmedKey = rawKey?.trim();

  if (!trimmedKey) {
    return defaultIndexNowKey;
  }

  return trimmedKey;
}

export function normalizeSiteUrl(siteUrl: string): string {
  return new URL(siteUrl).toString().replace(/\/$/, "");
}

export function buildIndexNowKeyLocation(siteUrl: string, key: string): string {
  return `${normalizeSiteUrl(siteUrl)}/indexnow-${key}.txt`;
}

function joinUrl(siteUrl: string, pathname: string): string {
  const normalizedSiteUrl = normalizeSiteUrl(siteUrl);
  return pathname === "/" ? `${normalizedSiteUrl}/` : `${normalizedSiteUrl}${pathname}`;
}

export function buildIndexNowUrlList(siteUrl: string, slugs: string[]): string[] {
  const uniqueSlugs = Array.from(new Set(slugs));

  const defaultUrls = [
    ...staticPaths.map((pathname) => joinUrl(siteUrl, pathname)),
    ...uniqueSlugs.map((slug) => joinUrl(siteUrl, `/charts/${encodeURIComponent(slug)}`)),
  ];

  const localizedUrls = prefixedLocales.flatMap((locale) => [
    ...staticPaths.map((pathname) =>
      joinUrl(siteUrl, pathname === "/" ? `/${locale}` : `/${locale}${pathname}`)
    ),
    ...uniqueSlugs.map((slug) => joinUrl(siteUrl, `/${locale}/charts/${encodeURIComponent(slug)}`)),
  ]);

  return [...defaultUrls, ...localizedUrls];
}

export function assertValidIndexNowConfig(input: { siteUrl: string; key: string }) {
  const siteUrl = input.siteUrl.trim();
  const key = input.key.trim();

  if (!siteUrl) {
    throw new Error("INDEXNOW_SITE_URL is required");
  }

  if (!key) {
    throw new Error("INDEXNOW_KEY is required");
  }

  const normalizedSiteUrl = normalizeSiteUrl(siteUrl);
  const site = new URL(normalizedSiteUrl);
  const keyLocation = new URL(buildIndexNowKeyLocation(normalizedSiteUrl, key));

  if (site.host !== keyLocation.host) {
    throw new Error(
      `IndexNow keyLocation host ${keyLocation.host} does not match site host ${site.host}`
    );
  }

  return {
    siteUrl: normalizedSiteUrl,
    key,
  };
}

export function getOptionalIndexNowConfig(input: { siteUrl: string; key: string }) {
  const siteUrl = input.siteUrl.trim();
  const key = input.key.trim();

  if (!siteUrl || !key) {
    return null;
  }

  return assertValidIndexNowConfig({ siteUrl, key });
}

export function buildIndexNowPayload(input: {
  siteUrl: string;
  key: string;
  urlList: string[];
}): IndexNowPayload {
  const normalizedSiteUrl = normalizeSiteUrl(input.siteUrl);
  const site = new URL(normalizedSiteUrl);

  for (const url of input.urlList) {
    if (new URL(url).host !== site.host) {
      throw new Error(`IndexNow urlList entries must belong to host ${site.host}`);
    }
  }

  return {
    host: site.host,
    key: input.key,
    keyLocation: buildIndexNowKeyLocation(normalizedSiteUrl, input.key),
    urlList: input.urlList,
  };
}
