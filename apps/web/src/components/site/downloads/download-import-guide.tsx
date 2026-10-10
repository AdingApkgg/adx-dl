"use client";

import * as React from "react";
import Link from "next/link";
import type { ArchiveFormat } from "@/lib/adx-archive-shared";
import { detectDownloadPlatform, type DownloadPlatform } from "@/lib/download-platform";
import { buildLocalePath, getDictionary, type Locale } from "@/lib/i18n";
import { CHART_IMPORT_VIDEO_URL } from "@/lib/resource-links";

export function DownloadImportGuide({ locale, format, split, cacheReleased = false }: {
  locale: Locale;
  format: ArchiveFormat;
  split: boolean;
  cacheReleased?: boolean;
}) {
  const copy = getDictionary(locale).downloads.importGuide;
  const [platform, setPlatform] = React.useState<DownloadPlatform>("desktop");
  const titleId = React.useId();
  const radioName = React.useId();

  React.useEffect(() => {
    setPlatform(detectDownloadPlatform(navigator));
  }, []);

  return (
    <section aria-labelledby={titleId} className="rounded-lg border border-primary/20 bg-primary/5 p-2.5 text-xs leading-relaxed">
      <h3 id={titleId} className="font-medium text-foreground">{copy.title}</h3>
      {split ? <p className="mt-1 text-muted-foreground">{copy.splitHint}</p> : null}
      {format === "zip" ? <p className="mt-1 text-muted-foreground">{copy.zipHint}</p> : null}
      {format === "tar.gz" ? <p className="mt-1 text-muted-foreground">{copy.tarHint}</p> : (
        <>
          <fieldset className="mt-1 flex flex-wrap gap-1">
            <legend className="sr-only">{copy.platformLabel}</legend>
            {(["ios", "android", "desktop"] as const).map((value) => (
              <label key={value} className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md px-2 has-checked:bg-primary/10 has-checked:text-primary">
                <input type="radio" name={radioName} value={value} checked={platform === value} onChange={() => setPlatform(value)} className="size-3.5 accent-primary" />
                {copy.platforms[value]}
              </label>
            ))}
          </fieldset>
          <ol className="mt-1 list-decimal space-y-1 pl-4 text-muted-foreground">
            <li>{copy.findFile}</li>
            {copy.steps[platform].map((step) => <li key={step}>{step}</li>)}
          </ol>
        </>
      )}
      <div className="mt-1 flex flex-wrap gap-x-3">
        <a href={CHART_IMPORT_VIDEO_URL} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-primary underline underline-offset-4">{copy.videoLink}</a>
        <Link href={`${buildLocalePath("/guide", locale)}#import`} className="inline-flex min-h-11 items-center text-primary underline underline-offset-4">{copy.guideLink}</Link>
        <Link href={`${buildLocalePath("/guide", locale)}#troubleshooting`} className="inline-flex min-h-11 items-center text-primary underline underline-offset-4">{copy.troubleshootingLink}</Link>
      </div>
      <details className="text-muted-foreground">
        <summary className="min-h-11 cursor-pointer rounded-sm py-3 focus-visible:outline-2 focus-visible:outline-ring">{copy.helpLabel}</summary>
        <p className="mt-1">{cacheReleased ? copy.helpBodyReleased : copy.helpBody}</p>
      </details>
    </section>
  );
}
