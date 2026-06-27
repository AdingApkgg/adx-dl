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
  // Ordered format fallback via <picture>: local AVIF (smallest) → local WebP
  // (for browsers without AVIF) → the remote original as the final <img> src.
  // The <img> fill styling mirrors what next/image fill emitted (the site is a
  // static export, so Image was unoptimized and bought us nothing over <picture>).
  const avif = entry.media.cover_avif;
  const webp = entry.media.cover_webp;
  const original = entry.media.cover_url;
  const imgSrc = original || avif || webp;

  if (imgSrc) {
    return (
      <div className={cn("relative overflow-hidden rounded-xl", className)}>
        <picture>
          {avif ? <source srcSet={avif} type="image/avif" /> : null}
          {webp ? <source srcSet={webp} type="image/webp" /> : null}
          <img
            src={imgSrc}
            alt={cover.alt(title)}
            sizes={sizes}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : "auto"}
            decoding="async"
          />
        </picture>
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
