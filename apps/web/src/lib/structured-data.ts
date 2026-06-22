import {
  buildChartDescription,
  difficultyLevelRange,
  difficultySlotLabel,
  formatEntryArtist,
  formatEntrySubcategory,
  formatEntryTitle,
  genreLabel,
  type CatalogEntry,
  type VersionGroup,
} from "@/lib/catalog-shared";
import {
  buildLocalePath,
  getDictionary,
  getStaticPageMetadata,
  type Locale,
} from "@/lib/i18n";
import { entrySlug } from "@/lib/route-slug";
import { resolveSiteUrl } from "@/lib/site-url";

const siteUrl = resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
const siteName = "ADX 谱面资源";
const organizationId = `${siteUrl}/#organization`;
const websiteId = `${siteUrl}/#website`;
const sourceRepository = "https://github.com/AdingApkgg/adx-dl";

type JsonLdValue = Record<string, unknown>;

function getStructuredDataLanguage(locale: Locale) {
  if (locale === "zh") {
    return "zh-CN";
  }

  return locale;
}

function toAbsoluteUrl(pathname: string) {
  if (!pathname) {
    return siteUrl;
  }

  if (/^https?:\/\//.test(pathname)) {
    return pathname;
  }

  return `${siteUrl}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

function buildOrganization(): JsonLdValue {
  return {
    "@type": "Organization",
    "@id": organizationId,
    name: siteName,
    url: siteUrl,
    logo: `${siteUrl}/opengraph-image.png`,
    sameAs: [sourceRepository],
  };
}

export function buildHomeStructuredData(locale: Locale): JsonLdValue {
  const pageMetadata = getStaticPageMetadata(locale).home;
  const homePath = buildLocalePath("/", locale);
  // Sitelinks-searchbox target: the catalog page hosts the in-page search box.
  const searchPath = buildLocalePath("/charts", locale);

  return {
    "@context": "https://schema.org",
    "@graph": [
      buildOrganization(),
      {
        "@type": "WebSite",
        "@id": websiteId,
        name: siteName,
        description: pageMetadata.description,
        url: toAbsoluteUrl(homePath),
        inLanguage: getStructuredDataLanguage(locale),
        publisher: { "@id": organizationId },
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${toAbsoluteUrl(searchPath)}?q={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      },
    ],
  };
}

export function buildHomeFaqStructuredData(
  locale: Locale,
  totalEntries: number,
  versionCount: number
): JsonLdValue {
  const items = getDictionary(locale).home.faq(totalEntries, versionCount);

  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    inLanguage: getStructuredDataLanguage(locale),
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a,
      },
    })),
  };
}

export function buildListingStructuredData(
  locale: Locale,
  entries: CatalogEntry[]
): JsonLdValue {
  const dictionary = getDictionary(locale);
  const meta = getStaticPageMetadata(locale).charts;
  const listPath = buildLocalePath(meta.pathname, locale);
  const listUrl = toAbsoluteUrl(listPath);

  const itemListElement = entries.slice(0, 100).map((entry, index) => ({
    "@type": "ListItem",
    position: index + 1,
    url: toAbsoluteUrl(buildLocalePath(`/charts/${encodeURIComponent(entrySlug(entry))}`, locale)),
    name: formatEntryTitle(entry, locale),
  }));

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": listUrl,
        url: listUrl,
        name: meta.title,
        description: meta.description,
        inLanguage: getStructuredDataLanguage(locale),
        isPartOf: { "@id": websiteId },
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: entries.length,
          itemListElement,
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: dictionary.nav.home,
            item: toAbsoluteUrl(buildLocalePath("/", locale)),
          },
          {
            "@type": "ListItem",
            position: 2,
            name: meta.title,
            item: listUrl,
          },
        ],
      },
    ],
  };
}

export function buildVersionsIndexStructuredData(
  locale: Locale,
  groups: VersionGroup[]
): JsonLdValue {
  const dictionary = getDictionary(locale);
  const versions = dictionary.versions;
  const listPath = buildLocalePath("/versions", locale);
  const listUrl = toAbsoluteUrl(listPath);

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": listUrl,
        url: listUrl,
        name: versions.title,
        description: dictionary.seo.versions,
        inLanguage: getStructuredDataLanguage(locale),
        isPartOf: { "@id": websiteId },
        mainEntity: (() => {
          const linkable = groups.filter((group) => group.count > 0);
          return {
            "@type": "ItemList",
            numberOfItems: linkable.length,
            itemListElement: linkable.map((group, index) => ({
              "@type": "ListItem",
              position: index + 1,
              url: toAbsoluteUrl(buildLocalePath(`/versions/${group.slug}`, locale)),
              name: group.name === "Unknown" ? versions.unknownLabel : group.name,
            })),
          };
        })(),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: dictionary.nav.home,
            item: toAbsoluteUrl(buildLocalePath("/", locale)),
          },
          { "@type": "ListItem", position: 2, name: versions.title, item: listUrl },
        ],
      },
    ],
  };
}

export function buildVersionDetailStructuredData(
  locale: Locale,
  name: string,
  slug: string,
  entries: CatalogEntry[]
): JsonLdValue {
  const dictionary = getDictionary(locale);
  const versions = dictionary.versions;
  const label = name === "Unknown" ? versions.unknownLabel : name;
  const path = buildLocalePath(`/versions/${slug}`, locale);
  const url = toAbsoluteUrl(path);

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": url,
        url,
        name: versions.detailTitle(label),
        description: dictionary.seo.versionDetail(label, entries.length),
        inLanguage: getStructuredDataLanguage(locale),
        isPartOf: { "@id": websiteId },
        mainEntity: {
          "@type": "ItemList",
          numberOfItems: entries.length,
          itemListElement: entries.slice(0, 100).map((entry, index) => ({
            "@type": "ListItem",
            position: index + 1,
            url: toAbsoluteUrl(
              buildLocalePath(`/charts/${encodeURIComponent(entrySlug(entry))}`, locale)
            ),
            name: formatEntryTitle(entry, locale),
          })),
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: dictionary.nav.home,
            item: toAbsoluteUrl(buildLocalePath("/", locale)),
          },
          {
            "@type": "ListItem",
            position: 2,
            name: versions.title,
            item: toAbsoluteUrl(buildLocalePath("/versions", locale)),
          },
          { "@type": "ListItem", position: 3, name: label, item: url },
        ],
      },
    ],
  };
}

export function buildChartDetailStructuredData(
  locale: Locale,
  entry: CatalogEntry
): JsonLdValue[] {
  const dictionary = getDictionary(locale);
  const title = formatEntryTitle(entry, locale);
  const artist = formatEntryArtist(entry, locale);
  const branch = formatEntrySubcategory(entry);
  const detailPath = buildLocalePath(`/charts/${encodeURIComponent(entrySlug(entry))}`, locale);
  const detailUrl = toAbsoluteUrl(detailPath);
  const aliases = entry.aliases ?? [];
  const keywords = [
    ...new Set(
      [entry.category, branch, entry.version, entry.cabinet, ...aliases].filter(Boolean)
    ),
  ];
  const range = difficultyLevelRange(entry);
  const difficultyNames = entry.difficulties
    .map((difficulty) => difficultySlotLabel(difficulty))
    .join(", ");

  const additionalProperty: JsonLdValue[] = [
    { "@type": "PropertyValue", name: "category", value: entry.category },
    { "@type": "PropertyValue", name: "branch", value: branch },
    ...(entry.version
      ? [{ "@type": "PropertyValue", name: "version", value: entry.version }]
      : []),
    ...(entry.bpm != null
      ? [{ "@type": "PropertyValue", name: "beatsPerMinute", value: entry.bpm }]
      : []),
    { "@type": "PropertyValue", name: "difficultyCount", value: entry.difficulties.length },
    ...(range
      ? [{ "@type": "PropertyValue", name: "levelRange", value: `${range.low}–${range.high}` }]
      : []),
    ...(difficultyNames
      ? [{ "@type": "PropertyValue", name: "difficulties", value: difficultyNames }]
      : []),
    ...(entry.short_id
      ? [{ "@type": "PropertyValue", name: "maimaiSongId", value: entry.short_id }]
      : []),
  ];

  const musicRecording: JsonLdValue = {
    "@context": "https://schema.org",
    "@type": "MusicRecording",
    "@id": `${detailUrl}#recording`,
    name: title,
    ...(aliases.length > 0 ? { alternateName: aliases } : {}),
    url: detailUrl,
    inLanguage: getStructuredDataLanguage(locale),
    description: buildChartDescription(entry, locale),
    byArtist: {
      "@type": "MusicGroup",
      name: artist,
    },
    ...(entry.genre ? { genre: genreLabel(entry, locale) } : {}),
    ...(entry.media.cover_url ? { image: toAbsoluteUrl(entry.media.cover_url) } : {}),
    isFamilyFriendly: true,
    isAccessibleForFree: true,
    keywords,
    identifier: entry.id,
    isPartOf: { "@id": websiteId },
    additionalProperty,
  };

  // The chart's promotional video, when present — eligible for video rich results.
  const videoObject: JsonLdValue | null = entry.media.pv_url
    ? {
        "@context": "https://schema.org",
        "@type": "VideoObject",
        "@id": `${detailUrl}#pv`,
        name: `${title} — PV`,
        description: buildChartDescription(entry, locale),
        contentUrl: toAbsoluteUrl(entry.media.pv_url),
        ...(entry.media.cover_url
          ? { thumbnailUrl: toAbsoluteUrl(entry.media.cover_url) }
          : {}),
        ...(entry.imported_at ? { uploadDate: entry.imported_at } : {}),
        inLanguage: getStructuredDataLanguage(locale),
        isFamilyFriendly: true,
      }
    : null;

  return [
    musicRecording,
    ...(videoObject ? [videoObject] : []),
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: dictionary.nav.home,
          item: toAbsoluteUrl(buildLocalePath("/", locale)),
        },
        {
          "@type": "ListItem",
          position: 2,
          name: dictionary.nav.browse,
          item: toAbsoluteUrl(buildLocalePath("/charts", locale)),
        },
        {
          "@type": "ListItem",
          position: 3,
          name: title,
          item: detailUrl,
        },
      ],
    },
  ];
}

export type { JsonLdValue };
