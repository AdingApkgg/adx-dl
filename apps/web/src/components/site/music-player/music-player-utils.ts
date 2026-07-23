import type { Locale } from "@/lib/i18n";
import type { MusicTrack } from "@/lib/music-playlists";

export function musicTrackTitle(track: MusicTrack, locale: Locale): string {
  return locale === "en" && track.titleEn ? track.titleEn : track.title;
}

export function musicTrackArtist(track: MusicTrack, locale: Locale): string {
  return locale === "en" && track.artistEn ? track.artistEn : track.artist;
}

export function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }

  const wholeSeconds = Math.floor(seconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const remaining = wholeSeconds % 60;
  return `${minutes}:${remaining.toString().padStart(2, "0")}`;
}

export function clampPlaybackTime(seconds: number, duration: number): number {
  if (!Number.isFinite(seconds)) {
    return 0;
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    return Math.max(0, seconds);
  }
  return Math.min(duration, Math.max(0, seconds));
}
