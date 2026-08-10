"use client";

import { PlayIcon } from "lucide-react";

import { motion, springSoft } from "@/components/motion";
import { useMusicPlayerPreferences } from "@/components/site/music-player/music-player-preferences";
import { useMusicPlayerStore } from "@/components/site/music-player/music-player-store";
import { VersionTileCard } from "@/components/site/version-tile-card";
import { getDictionary, type Locale } from "@/lib/i18n";
import type { MusicVersionSummary } from "@/lib/music-playlists";

type MusicVersionGridProps = {
  versions: MusicVersionSummary[];
  locale: Locale;
};

/**
 * The /music grid. Each tile hands a "play this version" intent to the global
 * player rather than owning any audio itself — there is exactly one <audio>
 * element on the page and the player enforces the autoplay and media-
 * coordination rules around it (see music-player-store's playRequest).
 */
export function MusicVersionGrid({ versions, locale }: MusicVersionGridProps) {
  const music = getDictionary(locale).music;
  const requestVersionPlayback = useMusicPlayerStore(
    (state) => state.requestVersionPlayback
  );
  const setEnabled = useMusicPlayerPreferences((state) => state.setEnabled);
  const setCollapsed = useMusicPlayerPreferences((state) => state.setCollapsed);

  const play = (versionId: number) => {
    // A visitor who had hidden the player and then pressed play here means the
    // player to come back — and if it stays unmounted, nothing consumes the
    // request at all. Expanding it also makes the now-playing track visible.
    setEnabled(true);
    setCollapsed(false);
    requestVersionPlayback(versionId);
  };

  return (
    <ul className="grid list-none grid-cols-2 gap-3 p-0 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {versions.map((version) => (
        <li key={version.slug} className="h-full">
          <motion.div
            className="h-full"
            initial={false}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.98 }}
            transition={springSoft}
            // whileTap makes framer-motion focusable-by-default; the button
            // inside is already the tab stop, so leave it as the only one.
            tabIndex={-1}
          >
            <button
              type="button"
              onClick={() => play(version.versionId)}
              aria-label={music.playVersion(version.name)}
              className="group/version relative block h-full w-full cursor-pointer rounded-xl text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <VersionTileCard
                name={version.name}
                imageIndex={version.versionId}
                count={version.count}
                countLabel={music.trackCount(version.count)}
                locale={locale}
              />
              {/* Sits over the logo's lower-right, where the tile has the most
                  empty space; the #index badge and the count own the top row. */}
              <span
                aria-hidden="true"
                className="absolute right-2 bottom-11 flex size-9 items-center justify-center rounded-full bg-primary/90 text-primary-foreground shadow-lg transition-transform group-hover/version:scale-110"
              >
                <PlayIcon className="size-4 fill-current" />
              </span>
            </button>
          </motion.div>
        </li>
      ))}
    </ul>
  );
}
