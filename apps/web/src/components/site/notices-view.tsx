import Link from "next/link";

import { Reveal } from "@/components/motion";
import { NoticesReadMarker } from "@/components/site/notices-read-marker";
import { SeoJsonLd } from "@/components/site/seo-json-ld";
import { Badge } from "@/components/ui/badge";
import { buildLocalePath, getDictionary, type Locale } from "@/lib/i18n";
import { isActive, notices, resolveText, sortNotices, todayUtc } from "@/lib/notices";
import { buildInfoPageStructuredData } from "@/lib/structured-data";

export function NoticesView({ locale = "zh" }: { locale?: Locale }) {
  const { notices: copy, seo } = getDictionary(locale);
  // Evaluated at build time. CI redeploys the whole site daily, so an expiry can
  // be at most a day stale here; the banner is client-side and always exact.
  const today = todayUtc();
  const ordered = sortNotices(notices, today);
  const activeIds = ordered.filter((notice) => isActive(notice, today)).map((notice) => notice.id);

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 md:px-6 md:py-10"
    >
      <SeoJsonLd
        data={buildInfoPageStructuredData(locale, {
          pathname: "/notices",
          title: copy.title,
          description: seo.notices,
        })}
      />
      <Reveal className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{copy.title}</h1>
        <p className="text-muted-foreground">{copy.description}</p>
        <p className="text-sm text-muted-foreground">{copy.intro}</p>
      </Reveal>
      <NoticesReadMarker ids={activeIds} />
      {ordered.length === 0 ? (
        <p className="text-muted-foreground">{copy.empty}</p>
      ) : (
        <ul className="flex list-none flex-col gap-4 p-0">
          {ordered.map((notice) => {
            const title = resolveText(notice.title, locale);
            const body = resolveText(notice.body, locale);
            const active = isActive(notice, today);
            const label = notice.link ? resolveText(notice.link.label, locale).value : null;
            const internal = notice.link?.href.startsWith("/") ?? false;

            return (
              <li
                key={notice.id}
                id={notice.id}
                className="flex scroll-mt-24 flex-col gap-2 rounded-lg border border-border bg-card p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {notice.level === "urgent" ? (
                    <Badge variant="destructive">{copy.urgentBadge}</Badge>
                  ) : null}
                  {active ? null : <Badge variant="outline">{copy.endedBadge}</Badge>}
                  <time dateTime={notice.publishedAt} className="text-xs text-muted-foreground">
                    {copy.publishedOn(notice.publishedAt)}
                  </time>
                </div>
                <h2 className="text-lg font-semibold">{title.value}</h2>
                <p className="whitespace-pre-line text-sm text-muted-foreground">{body.value}</p>
                {notice.link && label ? (
                  internal ? (
                    <Link
                      href={buildLocalePath(notice.link.href, locale)}
                      className="w-fit text-sm font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {label}
                    </Link>
                  ) : (
                    <a
                      href={notice.link.href}
                      target="_blank"
                      rel="noreferrer"
                      className="w-fit text-sm font-medium text-primary underline-offset-4 hover:underline"
                    >
                      {label}
                    </a>
                  )
                ) : null}
                {title.translated && body.translated ? null : (
                  <p className="text-xs text-muted-foreground/80">{copy.untranslated}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
