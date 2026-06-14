import Image from "next/image";
import Link from "next/link";

import { CatalogBrowser } from "@/components/site/catalog-browser";
import { SeoJsonLd } from "@/components/site/seo-json-ld";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { CatalogEntry, VersionGroup } from "@/lib/catalog-shared";
import { buildLocalePath, getDictionary, type Locale } from "@/lib/i18n";
import {
  buildVersionDetailStructuredData,
  buildVersionsIndexStructuredData,
} from "@/lib/structured-data";
import { VERSION_IMAGE_DIMENSIONS, versionImageSrc } from "@/lib/version-image";

type VersionsIndexViewProps = {
  groups: VersionGroup[];
  locale?: Locale;
};

type VersionDetailViewProps = {
  subcategory: string;
  slug: string;
  entries: CatalogEntry[];
  locale?: Locale;
};

export function VersionsIndexView({ groups, locale = "zh" }: VersionsIndexViewProps) {
  const versions = getDictionary(locale).versions;

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 md:px-6 md:py-10"
    >
      <SeoJsonLd data={buildVersionsIndexStructuredData(locale, groups)} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{versions.title}</h1>
        <p className="text-muted-foreground">{versions.description}</p>
        <p className="text-sm text-muted-foreground">{versions.intro(groups.length)}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {groups.map((group) => {
          const src = versionImageSrc(group.subcategory);
          const label =
            group.subcategory === "Unknown" ? versions.unknownLabel : group.subcategory;

          return (
            <Link
              key={group.slug}
              href={buildLocalePath(`/versions/${group.slug}`, locale)}
              className="group/version block rounded-xl transition-colors hover:bg-muted/40"
            >
              <Card size="sm" className="h-full overflow-hidden border border-border/70 bg-card/85">
                <div className="flex aspect-[332/160] items-center justify-center bg-background/60 p-4">
                  {src ? (
                    <Image
                      src={src}
                      alt={label}
                      width={VERSION_IMAGE_DIMENSIONS.width}
                      height={VERSION_IMAGE_DIMENSIONS.height}
                      unoptimized
                      className="h-full w-auto object-contain transition-transform group-hover/version:scale-[1.03]"
                    />
                  ) : (
                    <span className="text-center text-lg font-semibold text-muted-foreground">
                      {label}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 px-3 pb-1">
                  <span className="min-w-0 truncate text-sm font-medium">{label}</span>
                  <Badge variant="secondary">{versions.chartCount(group.count)}</Badge>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </main>
  );
}

export function VersionDetailView({
  subcategory,
  slug,
  entries,
  locale = "zh",
}: VersionDetailViewProps) {
  const versions = getDictionary(locale).versions;
  const label = subcategory === "Unknown" ? versions.unknownLabel : subcategory;
  const src = versionImageSrc(subcategory);

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 md:px-6 md:py-10"
    >
      <SeoJsonLd data={buildVersionDetailStructuredData(locale, subcategory, slug, entries)} />
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {src ? (
            <Image
              src={src}
              alt={label}
              width={VERSION_IMAGE_DIMENSIONS.width}
              height={VERSION_IMAGE_DIMENSIONS.height}
              unoptimized
              className="h-9 w-auto rounded-md"
            />
          ) : null}
          <h1 className="text-3xl font-semibold">{versions.detailTitle(label)}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {versions.detailIntro(label, entries.length)}
        </p>
      </div>
      <CatalogBrowser
        entries={entries}
        locale={locale}
        detailPathPrefix={buildLocalePath("/charts", locale)}
      />
    </main>
  );
}
