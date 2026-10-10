import Link from "next/link";
import { DifficultyPill } from "@/components/site/difficulty-pill";
import { formatEntryTitle, type CatalogCardEntry } from "@/lib/catalog-shared";
import { buildLocalePath, getDictionary, type Locale } from "@/lib/i18n";
import { DAN_COURSE_VERSION, resolveDanCourse, type DanCourse } from "@/lib/maimai-dan";
import { entrySlug } from "@/lib/route-slug";

export function DanCourseSummary({ course, entries, locale }: {
  course: DanCourse;
  entries: readonly CatalogCardEntry[];
  locale: Locale;
}) {
  const dictionary = getDictionary(locale).catalogBrowser;
  const label = dictionary.danCourseName(course.id, course.name);
  return (
    <section aria-label={label} className="space-y-3 rounded-xl border border-border/60 bg-card/60 p-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold">{label}</h3>
        <span className="text-xs text-muted-foreground">{DAN_COURSE_VERSION} · {dictionary.danRegion}</span>
      </div>
      <ol className="grid list-none gap-2 p-0 sm:grid-cols-2 lg:grid-cols-4">
        {resolveDanCourse(course, entries).map(({ songId, order, entry, difficulty }) => (
          <li key={order} className="flex min-w-0 items-start gap-2 rounded-lg bg-muted/40 p-2">
            <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs tabular-nums">{order}</span>
            <div className="min-w-0 space-y-1">
              {entry && difficulty ? (
                <>
                  <Link href={buildLocalePath(`/charts/${entrySlug(entry)}`, locale)} className="block text-sm hover:underline">{formatEntryTitle(entry, locale)}</Link>
                  <DifficultyPill difficulty={difficulty} showLabel />
                </>
              ) : (
                <span className="text-xs text-muted-foreground">#{songId} · {dictionary.danOutsideCatalog}</span>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
