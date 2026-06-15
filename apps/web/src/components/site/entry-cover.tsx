import Image from "next/image";

import {
  formatEntrySubcategory,
  formatEntryTitle,
  type CatalogEntry,
} from "@/lib/catalog-shared";
import { getDictionary } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type EntryCoverProps = {
  entry: CatalogEntry;
  locale: "zh" | "en" | "ja";
  className?: string;
  /** Eagerly load above-the-fold covers (LCP). Next 16: use loading/fetchPriority, not the deprecated `priority` prop. */
  priority?: boolean;
  sizes?: string;
};

export function EntryCover({
  entry,
  locale,
  className,
  priority = false,
  sizes = "(max-width: 768px) 100vw, 512px",
}: EntryCoverProps) {
  const title = formatEntryTitle(entry, locale);
  const cover = getDictionary(locale).cover;
  // Prefer the small local AVIF; fall back to the remote original when a chart
  // has no converted copy.
  const coverSrc = entry.media.cover_avif || entry.media.cover_url;

  if (coverSrc) {
    return (
      <div className={cn("relative overflow-hidden rounded-xl", className)}>
        <Image
          src={coverSrc}
          alt={cover.alt(title)}
          fill
          unoptimized
          sizes={sizes}
          className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
        />
      </div>
    );
  }

  return (
    <div
      role="img"
      aria-label={cover.placeholder}
      className={cn(
        "flex h-full w-full items-end rounded-xl bg-linear-to-br from-slate-950 via-slate-800 to-blue-700 p-4 text-white",
        className
      )}
    >
      <div className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-[0.24em] text-white/70">
          {formatEntrySubcategory(entry)}
        </span>
        <span className="line-clamp-2 text-lg font-semibold">{title}</span>
      </div>
    </div>
  );
}
