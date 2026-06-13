import Image from "next/image";

import {
  formatEntrySubcategory,
  formatEntryTitle,
  type CatalogEntry,
} from "@/lib/catalog-shared";
import { cn } from "@/lib/utils";

type EntryCoverProps = {
  entry: CatalogEntry;
  locale: "zh" | "en" | "ja";
  className?: string;
};

export function EntryCover({ entry, locale, className }: EntryCoverProps) {
  const title = formatEntryTitle(entry, locale);

  if (entry.media.cover_url) {
    return (
      <div className={cn("relative overflow-hidden rounded-xl", className)}>
        <Image
          src={entry.media.cover_url}
          alt={`${title} cover`}
          fill
          unoptimized
          sizes="(max-width: 768px) 100vw, 512px"
          className="object-cover"
        />
      </div>
    );
  }

  return (
    <div
      aria-label="AstroDX cover placeholder"
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
