import { SyncedVideoAudio } from "@/components/site/synced-video-audio";
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

// Sources are remote (adx-dl.larx.cc); we preconnect to that host in the root
// layout. The PV ships without an audio track and the song lives in a separate
// track.mp3 of identical length, so when both exist we render a single player
// (<SyncedVideoAudio>) that slaves the audio to the video — playing the video
// plays the song in sync. The PV-only / audio-only fallbacks stay plain native
// elements (no client JS, prerender fine under output: export).
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
        {hasPv && hasAudio ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-muted-foreground">{detail.pvLabel}</h3>
            <SyncedVideoAudio
              videoSrc={entry.media.pv_url}
              audioSrc={entry.media.audio_url}
              poster={entry.media.cover_url || undefined}
              ariaLabel={`${title} ${detail.pvLabel}`}
              unsupportedLabel={detail.mediaUnsupported}
              volumeLabel={detail.volumeLabel}
              muteLabel={detail.muteLabel}
              className="aspect-video w-full rounded-xl border border-border/60 bg-black [color-scheme:dark]"
            />
          </div>
        ) : hasPv ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-muted-foreground">{detail.pvLabel}</h3>
            <video
              controls
              playsInline
              preload="metadata"
              poster={entry.media.cover_url || undefined}
              src={entry.media.pv_url}
              aria-label={`${title} ${detail.pvLabel}`}
              className="aspect-video w-full rounded-xl border border-border/60 bg-black [color-scheme:dark]"
            >
              {detail.mediaUnsupported}
            </video>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-muted-foreground">{detail.audioLabel}</h3>
            <audio
              controls
              preload="none"
              src={entry.media.audio_url}
              aria-label={`${title} ${detail.audioLabel}`}
              className="w-full rounded-full dark:[color-scheme:dark]"
            >
              {detail.mediaUnsupported}
            </audio>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
