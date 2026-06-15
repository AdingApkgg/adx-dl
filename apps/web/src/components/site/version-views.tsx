import Image from "next/image";
import Link from "next/link";

import { Reveal, RevealGroup, RevealItem } from "@/components/motion";
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
import { VERSION_IMAGE_DIMENSIONS, versionImageSrcByIndex } from "@/lib/version-image";
import { cn } from "@/lib/utils";

type VersionsIndexViewProps = {
  groups: VersionGroup[];
  locale?: Locale;
};

type VersionDetailViewProps = {
  name: string;
  slug: string;
  imageIndex: number | null;
  entries: CatalogEntry[];
  locale?: Locale;
};

export function VersionsIndexView({ groups, locale = "zh" }: VersionsIndexViewProps) {
  const versions = getDictionary(locale).versions;
  const withCharts = groups.filter((group) => group.count > 0).length;

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 md:px-6 md:py-10"
    >
      <SeoJsonLd data={buildVersionsIndexStructuredData(locale, groups)} />
      <Reveal className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{versions.title}</h1>
        <p className="text-muted-foreground">{versions.description}</p>
        <p className="text-sm text-muted-foreground">{versions.intro(withCharts)}</p>
      </Reveal>
      <RevealGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {groups.map((group) => {
          const label = group.name === "Unknown" ? versions.unknownLabel : group.name;
          const src = group.imageIndex !== null ? versionImageSrcByIndex(group.imageIndex) : null;
          const hasCharts = group.count > 0;

          const card = (
            <Card
              size="sm"
              className={cn(
                "h-full overflow-hidden border border-border/70 bg-card/85 transition-all",
                hasCharts &&
                  "group-hover/version:border-primary/40 group-hover/version:shadow-lg group-hover/version:shadow-primary/10",
                !hasCharts && "opacity-45"
              )}
            >
              <div className="flex aspect-[332/160] items-center justify-center bg-background/60 p-4">
                {src ? (
                  <Image
                    src={src}
                    alt={label}
                    width={VERSION_IMAGE_DIMENSIONS.width}
                    height={VERSION_IMAGE_DIMENSIONS.height}
                    unoptimized
                    className={cn(
                      "h-full w-auto object-contain",
                      hasCharts && "transition-transform group-hover/version:scale-[1.03]"
                    )}
                  />
                ) : (
                  <span className="text-center text-lg font-semibold text-muted-foreground">
                    {label}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 px-3 pb-1">
                <span className="min-w-0 truncate text-sm font-medium">{label}</span>
                <Badge variant={hasCharts ? "secondary" : "outline"}>
                  {versions.chartCount(group.count)}
                </Badge>
              </div>
            </Card>
          );

          if (!hasCharts) {
            return (
              <RevealItem key={group.slug} className="h-full" aria-disabled="true">
                {card}
              </RevealItem>
            );
          }

          return (
            <RevealItem key={group.slug} className="h-full">
              <Link
                href={buildLocalePath(`/versions/${group.slug}`, locale)}
                className="group/version block h-full rounded-xl transition-transform hover:-translate-y-0.5"
              >
                {card}
              </Link>
            </RevealItem>
          );
        })}
      </RevealGroup>
    </main>
  );
}

export function VersionDetailView({
  name,
  slug,
  imageIndex,
  entries,
  locale = "zh",
}: VersionDetailViewProps) {
  const versions = getDictionary(locale).versions;
  const label = name === "Unknown" ? versions.unknownLabel : name;
  const src = imageIndex !== null ? versionImageSrcByIndex(imageIndex) : null;

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 md:px-6 md:py-10"
    >
      <SeoJsonLd data={buildVersionDetailStructuredData(locale, name, slug, entries)} />
      <Reveal className="flex flex-col gap-3">
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
      </Reveal>
      <CatalogBrowser
        entries={entries}
        locale={locale}
        detailPathPrefix={buildLocalePath("/charts", locale)}
      />
    </main>
  );
}
