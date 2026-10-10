import Link from "next/link";
import { Suspense } from "react";
import { ChartPreviewRoutePlayer } from "@/components/chart-preview/chart-preview-route-player";
import { formatEntryTitle, formatEntryArtist, difficultySlotLabel, type CatalogEntry } from "@/lib/catalog-shared";
import { buildLocalePath, getDictionary, type Locale } from "@/lib/i18n";
import { buildPreviewHref, getChartPreviewAssets } from "@/lib/chart-preview-route";
import { chartPreviewDescription } from "@/lib/chart-preview-copy";
import { entrySlug } from "@/lib/route-slug";

export function ChartPreviewPageView({ entry, locale }: { entry: CatalogEntry; locale: Locale }) {
  const dictionary = getDictionary(locale);
  const title = formatEntryTitle(entry, locale);
  const detailHref = buildLocalePath(`/charts/${encodeURIComponent(entrySlug(entry))}`, locale);
  const highestDifficulty = entry.difficulties.length ? Math.max(...entry.difficulties.map((d) => d.slot)) : undefined;
  return (
    <main id="main-content" className="mx-auto flex w-full min-w-0 max-w-7xl flex-col gap-6 px-4 py-6 md:px-6">
      <nav aria-label={dictionary.detail.breadcrumbLabel} className="flex flex-wrap gap-2 text-sm">
        <Link href={buildLocalePath("/charts", locale)} className="text-primary underline">{dictionary.nav.browse}</Link>
        <span aria-hidden="true">/</span>
        <Link href={detailHref} className="text-primary underline">{title}</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{dictionary.detail.chartPreview}</span>
      </nav>
      <header className="min-w-0 space-y-2 [overflow-wrap:anywhere]">
        <h1 className="text-2xl font-bold md:text-3xl">{title} · {dictionary.detail.chartPreview}</h1>
        <p className="text-muted-foreground">{formatEntryArtist(entry, locale)}</p>
        <p className="max-w-4xl text-sm leading-relaxed text-muted-foreground">{chartPreviewDescription(entry, locale)}</p>
      </header>
      <nav aria-label={dictionary.detail.difficulties} className="flex flex-wrap gap-2">
        {entry.difficulties.map((difficulty) => (
          <Link key={difficulty.slot} href={buildPreviewHref(entry, locale, difficulty.slot)} className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-sm hover:bg-muted">
            {difficultySlotLabel(difficulty)} {difficulty.level}
          </Link>
        ))}
      </nav>
      <Suspense fallback={<div className="mx-auto aspect-square w-full max-w-[600px] animate-pulse rounded-lg bg-muted" />}>
      <ChartPreviewRoutePlayer {...getChartPreviewAssets(entry)} chartName={`${entry.short_id || entry.id}-${title}`} locale={locale} levels={Object.fromEntries(entry.difficulties.map((d) => [d.slot, d.level]))} defaultDifficulty={highestDifficulty} />
      </Suspense>
    </main>
  );
}
