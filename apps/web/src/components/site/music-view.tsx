import { Reveal } from "@/components/motion";
import { MusicVersionGrid } from "@/components/site/music-version-grid";
import { SeoJsonLd } from "@/components/site/seo-json-ld";
import { getDictionary, type Locale } from "@/lib/i18n";
import type { MusicVersionSummary } from "@/lib/music-playlists";
import { buildInfoPageStructuredData } from "@/lib/structured-data";

type MusicViewProps = {
  versions: MusicVersionSummary[];
  locale?: Locale;
};

/**
 * The linkable home of the global music player. The grid renders from
 * build-time version summaries alone — the ~700 KB playlists.json manifest is
 * still only fetched once playback actually starts, so arriving here costs
 * nothing extra.
 */
export function MusicView({ versions, locale = "zh" }: MusicViewProps) {
  const { music, seo } = getDictionary(locale);

  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 md:px-6 md:py-10"
    >
      <SeoJsonLd
        data={buildInfoPageStructuredData(locale, {
          pathname: "/music",
          title: music.title,
          description: seo.music,
        })}
      />
      <Reveal ssrVisible className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{music.title}</h1>
        <p className="text-muted-foreground">{music.description}</p>
        <p className="text-sm text-muted-foreground">{music.intro}</p>
      </Reveal>
      {versions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{music.empty}</p>
      ) : (
        <MusicVersionGrid versions={versions} locale={locale} />
      )}
    </main>
  );
}
