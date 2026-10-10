import { prefixedLocales } from "@/lib/i18n";
import { entrySlug } from "@/lib/route-slug";

export type IndexNowPayload = {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
};

// The subset of a catalog entry that decides whether its URLs need re-submitting.
export type IndexNowCatalogEntry = {
  id: string;
  slug?: string | null;
  imported_at?: string | null;
  files?: { maidata?: string | null };
};

const staticPaths = [
  "/",
  "/charts",
  "/versions",
  "/changelog",
  "/music",
  "/guide",
  "/community",
  "/links",
  "/donate",
  "/about",
] as const;

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

export function buildIndexNowUrlList(siteUrl: string, slugs: string[], previewSlugs: string[] = []): string[] {
  const uniqueSlugs = Array.from(new Set(slugs));
  const uniquePreviewSlugs = Array.from(new Set(previewSlugs));

  const defaultUrls = [
    ...staticPaths.map((pathname) => joinUrl(siteUrl, pathname)),
    ...uniqueSlugs.map((slug) => joinUrl(siteUrl, `/charts/${encodeURIComponent(slug)}`)),
    ...uniquePreviewSlugs.map((slug) => joinUrl(siteUrl, `/preview/${encodeURIComponent(slug)}`)),
  ];

  const localizedUrls = prefixedLocales.flatMap((locale) => [
    ...staticPaths.map((pathname) =>
      joinUrl(siteUrl, pathname === "/" ? `/${locale}` : `/${locale}${pathname}`)
    ),
    ...uniqueSlugs.map((slug) => joinUrl(siteUrl, `/${locale}/charts/${encodeURIComponent(slug)}`)),
    ...uniquePreviewSlugs.map((slug) => joinUrl(siteUrl, `/${locale}/preview/${encodeURIComponent(slug)}`)),
  ]);

  return [...defaultUrls, ...localizedUrls];
}

export function selectIndexNowPreviewSlugs(entries: IndexNowCatalogEntry[], changedSlugs: string[], frontendChanged: boolean): string[] {
  const changed = new Set(changedSlugs);
  return entries.filter((entry) => Boolean(entry.files?.maidata) && (frontendChanged || changed.has(entrySlug(entry)))).map(entrySlug);
}

/** IndexNow accepts at most 10000 URLs per POST. */
export function chunkIndexNowUrls(urls: string[]): string[][] {
  const chunks: string[][] = [];
  for (let offset = 0; offset < urls.length; offset += 10000) chunks.push(urls.slice(offset, offset + 10000));
  return chunks;
}

// Which entries changed between two catalog builds. An entry needs re-submitting
// when it is new, when its canonical URL moved, or when its imported_at was
// restamped — which build_catalog only does when the entry's content fingerprint
// genuinely changed (see pipeline/tools/build_catalog.py:_carry_forward_timestamps).
// Deletions are skipped: the URL is already gone, so IndexNow has nothing to fetch.
export function diffChangedSlugs(
  previousEntries: IndexNowCatalogEntry[],
  currentEntries: IndexNowCatalogEntry[]
): string[] {
  const previousById = new Map(
    previousEntries.filter((entry) => entry?.id).map((entry) => [entry.id, entry])
  );

  const changedSlugs: string[] = [];

  for (const entry of currentEntries) {
    if (!entry?.id) {
      continue;
    }

    const slug = entrySlug(entry);
    const previous = previousById.get(entry.id);

    const isChanged =
      !previous ||
      entrySlug(previous) !== slug ||
      (previous.imported_at ?? null) !== (entry.imported_at ?? null) ||
      Boolean(previous.files?.maidata) !== Boolean(entry.files?.maidata);

    if (isChanged) {
      changedSlugs.push(slug);
    }
  }

  return changedSlugs;
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
