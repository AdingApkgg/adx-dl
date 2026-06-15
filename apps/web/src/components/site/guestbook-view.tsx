import { ChartComments } from "@/components/site/chart-comments";
import { getDictionary, type Locale } from "@/lib/i18n";

// Standalone guestbook: one shared Artalk thread keyed by the locale-independent
// `/comments` path, so every language posts into the same board.
const GUESTBOOK_PAGE_KEY = "/comments";

export function GuestbookView({ locale = "zh" }: { locale?: Locale }) {
  const { guestbook } = getDictionary(locale);

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 md:px-6 md:py-10"
    >
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{guestbook.title}</h1>
        <p className="text-muted-foreground">{guestbook.description}</p>
        <p className="text-sm text-muted-foreground">{guestbook.intro}</p>
      </div>
      <ChartComments pageKey={GUESTBOOK_PAGE_KEY} pageTitle={guestbook.title} locale={locale} />
    </main>
  );
}
