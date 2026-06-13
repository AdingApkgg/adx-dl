import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatEntryTitle, type CatalogEntry } from "@/lib/catalog-shared";
import { getDictionary, type Locale } from "@/lib/i18n";

type ChartMediaPlayerProps = {
  entry: CatalogEntry;
  locale: Locale;
};

// Native <video>/<audio> players — no client JS needed, so this stays a Server
// Component and prerenders fine under output: export. Sources are remote
// (adx-dl.larx.cc); we preconnect to that host in the root layout.
export function ChartMediaPlayer({ entry, locale }: ChartMediaPlayerProps) {
  const hasPv = entry.assets.has_pv && Boolean(entry.media.pv_url);
  const hasAudio = entry.assets.has_audio && Boolean(entry.media.audio_url);

  if (!hasPv && !hasAudio) {
    return null;
  }

  const detail = getDictionary(locale).detail;
  const title = formatEntryTitle(entry, locale);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{detail.preview}</CardTitle>
        <CardDescription>{detail.previewDescription}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {hasPv ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-muted-foreground">{detail.pvLabel}</h3>
            <video
              controls
              playsInline
              preload="metadata"
              poster={entry.media.cover_url || undefined}
              src={entry.media.pv_url}
              aria-label={`${title} ${detail.pvLabel}`}
              className="aspect-video w-full rounded-xl border border-border/60 bg-black"
            >
              {detail.mediaUnsupported}
            </video>
          </div>
        ) : null}
        {hasAudio ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-muted-foreground">{detail.audioLabel}</h3>
            <audio
              controls
              preload="none"
              src={entry.media.audio_url}
              aria-label={`${title} ${detail.audioLabel}`}
              className="w-full"
            >
              {detail.mediaUnsupported}
            </audio>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
