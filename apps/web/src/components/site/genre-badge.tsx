import { genreInfo, type CatalogEntry } from "@/lib/catalog-shared";
import { type Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type GenreBadgeProps = {
  entry: CatalogEntry;
  locale: Locale;
  className?: string;
};

// Colored, localized genre chip. The UTAGE genre (107) is suppressed because the
// cabinet icon already conveys it.
export function GenreBadge({ entry, locale, className }: GenreBadgeProps) {
  const info = genreInfo(entry);
  if (!info || info.id === 107) {
    return null;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        info.badge,
        className
      )}
    >
      {info[locale]}
    </span>
  );
}
