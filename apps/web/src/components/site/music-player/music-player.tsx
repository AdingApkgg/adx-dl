"use client";

import * as React from "react";
import { coverPaletteStyle } from "@/lib/cover-palette";
import { CoverPaletteBackdrop } from "./cover-palette-backdrop";
import { MusicLibraryPanel } from "./music-library-panel";
import {
  ChevronDownIcon,
  ListMusicIcon,
  LoaderCircleIcon,
  Music2Icon,
  PauseIcon,
  PlayIcon,
  Repeat1Icon,
  Repeat2Icon,
  ShuffleIcon,
  SkipBackIcon,
  SkipForwardIcon,
  Volume2Icon,
  VolumeXIcon,
  XIcon,
} from "lucide-react";
import { Dialog as DialogPrimitive, Slider as SliderPrimitive } from "radix-ui";
import useSWR from "swr";
import { useShallow } from "zustand/react/shallow";

import { AnimatePresence, MotionSurface, getSemanticTransition, getPressTarget, useMotionActivity, useReducedMotion } from "@astrodx/ui/motion";
import { CompatibleImage } from "@/components/site/compatible-image";
import { ScrollingLabel } from "@/components/site/scrolling-label";
import { useDownloadsStore } from "@/components/site/downloads/downloads-store";
import { Button } from "@astrodx/ui/components/button";

import type { VersionGroup } from "@/lib/catalog-shared";
import type { Locale } from "@/lib/i18n";
import {
  announceMediaPlay,
  MEDIA_PLAY_EVENT,
  type MediaOwner,
} from "@/lib/media-coordination";
import type {
  MusicPlaylistManifest,
  MusicTrack,
} from "@/lib/music-playlists";
import { jsonFetcher } from "@/lib/swr-fetcher";
import { cn } from "@astrodx/ui/lib/utils";
import { versionImageSourcesByIndex } from "@/lib/version-image";

import {
  getOrCreateMusicPlayerAudio,
  MUSIC_PLAYER_AUDIO_ID,
} from "./music-player-audio";
import { getMusicPlayerCopy } from "./music-player-copy";
import {
  syncMusicPlayerSurfaceAttribute,
  useMusicPlayerPreferences,
} from "./music-player-preferences";
import {
  readMusicPlayerSnapshot,
  type StoredMusicPlayerSnapshot,
  writeMusicPlayerSnapshot,
} from "./music-player-persistence";
import {
  type MusicPlayerMode,
  useMusicPlayerStore,
} from "./music-player-store";
import {
  clampPlaybackTime,
  formatPlaybackTime,
  musicTrackArtist,
  musicTrackTitle,
} from "./music-player-utils";

const PLAYLIST_MANIFEST_PATH = "/music/playlists.json";

const CHECKPOINT_INTERVAL_MS = 5_000;
const MODE_ORDER: MusicPlayerMode[] = [
  "sequence",
  "shuffle",
  "repeat-one",
];

type MusicVersion = Pick<
  VersionGroup,
  "name" | "slug" | "imageIndex" | "count"
>;

type MusicPlayerProps = {
  locale: Locale;
  versions: MusicVersion[];
  initialVersionId: number;
  initialTracks: MusicTrack[];
};

type PendingSeek = {
  trackId: string;
  time: number;
};

type PlayerControls = {
  play: () => void;
  pause: () => void;
  previous: () => void;
  next: () => void;
  seek: (time: number) => void;
};

function trackArtworkSources(track: MusicTrack) {
  return {
    ...(track.coverAvif ? { avif: track.coverAvif } : {}),
    ...(track.coverWebp ? { webp: track.coverWebp } : {}),
    png: track.coverUrl,
  };
}

function PlayerArtwork({
  track,
  versionId,
  alt,
  className,
}: {
  track: MusicTrack | null;
  versionId: string | null;
  alt: string;
  className?: string;
}) {
  const numericVersionId =
    versionId !== null && Number.isInteger(Number(versionId))
      ? Number(versionId)
      : null;
  const sources = track
    ? trackArtworkSources(track)
    : numericVersionId !== null
      ? versionImageSourcesByIndex(numericVersionId)
      : null;

  if (!sources) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "flex items-center justify-center bg-primary/12 text-primary",
          className
        )}
      >
        <Music2Icon className="size-1/2" />
      </span>
    );
  }

  return (
    <CompatibleImage
      sources={sources}
      alt={alt}
      width={160}
      height={160}
      loading="lazy"
      className={cn("object-contain", className)}
    />
  );
}

/**
 * How far into the track, drawn as a ring around a round control (the bar's
 * play button, the collapsed bubble). Reads at a glance where the old 2px
 * line along the bar's bottom edge did not — and on phones that line sat
 * under the bar's rounded corners.
 */
function ProgressRing({
  progress,
  className,
}: {
  progress: number;
  className?: string;
}) {
  const radius = 15;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 size-full -rotate-90", className)}
    >
      <circle cx="16" cy="16" r={radius} fill="none" strokeWidth="2" stroke="currentColor" opacity={0.2} />
      {progress > 0 ? (
        <circle
          cx="16"
          cy="16"
          r={radius}
          fill="none"
          strokeWidth="2"
          stroke="currentColor"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          data-motion-sensitive
          className="transition-[stroke-dashoffset] duration-(--adx-motion-duration-fast) ease-linear"
        />
      ) : null}
    </svg>
  );
}

/**
 * Seek and volume. Radix rather than <input type="range">: the native control
 * draws differently in every engine (and thumb styling there is vendor
 * pseudo-elements), so these match the rest of the site's controls instead.
 * The track thickens on hover and the thumb grows, to show it can be grabbed.
 */
function PlayerSlider({
  value,
  max,
  step,
  disabled,
  onValueChange,
  label,
  valueText,
  className,
}: {
  value: number;
  max: number;
  step: number;
  disabled?: boolean;
  onValueChange: (value: number) => void;
  label: string;
  valueText?: string;
  className?: string;
}) {
  return (
    <SliderPrimitive.Root
      value={[Math.min(Math.max(value, 0), max)]}
      min={0}
      max={max}
      step={step}
      disabled={disabled}
      onValueChange={([next]) => {
        if (next !== undefined) onValueChange(next);
      }}
      className={cn(
        "group/slider relative flex h-5 touch-none select-none items-center data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        className
      )}
    >
      <SliderPrimitive.Track
        data-motion-sensitive
        className="relative h-1 grow overflow-hidden rounded-full bg-foreground/12 transition-[height] duration-(--adx-motion-duration-fast) group-hover/slider:h-1.5"
      >
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={label}
        aria-valuetext={valueText}
        data-motion-sensitive
        className="block size-3 rounded-full border-2 border-primary bg-background shadow-sm transition-transform duration-(--adx-motion-duration-fast) outline-none group-hover/slider:scale-125 focus-visible:scale-125 focus-visible:ring-3 focus-visible:ring-ring/50"
      />
    </SliderPrimitive.Root>
  );
}

/**
 * The playing track's marker in the list: bars that bounce while it plays and
 * hold still while paused, so the list says which of the two it is.
 */
function PlaybackModeIcon({ mode }: { mode: MusicPlayerMode }) {
  if (mode === "shuffle") {
    return <ShuffleIcon />;
  }
  if (mode === "repeat-one") {
    return <Repeat1Icon />;
  }
  return <Repeat2Icon />;
}

export function MusicPlayer(props: MusicPlayerProps) {
  const enabled = useMusicPlayerPreferences((state) => state.enabled);
  const prefsHydrated = useMusicPlayerPreferences((state) => state.hydrated);
  const hydratePreferences = useMusicPlayerPreferences(
    (state) => state.hydrate
  );

  React.useEffect(() => {
    hydratePreferences();
    // Remounts after a (default) ↔ [locale] group navigation find the <html>
    // attributes reset by React — restore the persisted surface state.
    syncMusicPlayerSurfaceAttribute();
  }, [hydratePreferences]);

  // The <audio> element is a document-level singleton that survives unmounts
  // (deliberately, so playback crosses route transitions). Turning the player
  // off must therefore silence it explicitly.
  React.useEffect(() => {
    if (!prefsHydrated || enabled || typeof document === "undefined") {
      return;
    }
    const audio = document.getElementById(MUSIC_PLAYER_AUDIO_ID);
    if (audio instanceof HTMLAudioElement) {
      audio.pause();
    }
  }, [enabled, prefsHydrated]);

  if (!enabled) {
    return null;
  }
  return <MusicPlayerSurface {...props} />;
}

function MusicPlayerSurface({
  locale,
  versions,
  initialVersionId,
  initialTracks,
}: MusicPlayerProps) {
  const copy = getMusicPlayerCopy(locale);
  const collapsed = useMusicPlayerPreferences((state) => state.collapsed);
  const setCollapsed = useMusicPlayerPreferences(
    (state) => state.setCollapsed
  );
  const reducedMotion = useReducedMotion();
  const surfaceRef = React.useRef<HTMLDivElement>(null);
  const motionActive = useMotionActivity(surfaceRef);
  const layoutId = React.useId();
  const bottomBars = useDownloadsStore((state) => state.bottomBars);
  const audioRef = React.useRef<HTMLAudioElement>(null);
  const currentTimeRef = React.useRef(0);
  const pendingSeekRef = React.useRef<PendingSeek | null>(null);
  const failedTrackIdsRef = React.useRef(new Set<string>());
  const lastCheckpointRef = React.useRef(0);
  const playIntentRef = React.useRef(false);
  const controlsRef = React.useRef<PlayerControls>({
    play: () => {},
    pause: () => {},
    previous: () => {},
    next: () => {},
    seek: () => {},
  });
  const [open, setOpen] = React.useState(false);
  const [libraryOpen, setLibraryOpen] = React.useState(false);
  const libraryPanelId = React.useId();
  const expandTriggerRef = React.useRef<HTMLButtonElement>(null);
  const playlistTriggerRef = React.useRef<HTMLButtonElement>(null);
  const returnPanelFocus = React.useRef(false);
  // Keep the page inert even when nested menus update Radix's aria-hidden
  // bookkeeping. The player portal remains outside this public-page shell.
  React.useEffect(() => {
    if (!open) return;
    const shell = document.querySelector<HTMLElement>(".site-shell-background");
    if (!shell) return;
    const wasInert = shell.inert;
    shell.inert = true;
    return () => { shell.inert = wasInert; };
  }, [open]);
  const [manifestRequested, setManifestRequested] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [playIntent, setPlayIntent] = React.useState(false);

  const {
    tracksByVersion,
    versionId,
    trackId,
    queue,
    mode,
    status,
    volume,
    muted,
    error,
    hydrated,
    restorePending,
    playRequest,
    bootstrap,
    loadManifest,
    selectVersion,
    selectTrack,
    setMode,
    nextTrackId,
    setStatus,
    setVolume,
    setMuted,
    setError,
    clearPlayRequest,
  } = useMusicPlayerStore(
    useShallow((state) => ({
      tracksByVersion: state.tracksByVersion,
      versionId: state.versionId,
      trackId: state.trackId,
      queue: state.queue,
      mode: state.mode,
      status: state.status,
      volume: state.volume,
      muted: state.muted,
      error: state.error,
      hydrated: state.hydrated,
      restorePending: state.restorePending,
      playRequest: state.playRequest,
      bootstrap: state.bootstrap,
      loadManifest: state.loadManifest,
      selectVersion: state.selectVersion,
      selectTrack: state.selectTrack,
      setMode: state.setMode,
      nextTrackId: state.nextTrackId,
      setStatus: state.setStatus,
      setVolume: state.setVolume,
      setMuted: state.setMuted,
      setError: state.setError,
      clearPlayRequest: state.clearPlayRequest,
    }))
  );

  const needsPersistedManifest = hydrated && restorePending;
  const manifestKey =
    manifestRequested || open || needsPersistedManifest || playRequest !== null
      ? PLAYLIST_MANIFEST_PATH
      : null;
  const {
    data: manifest,
    error: manifestError,
    isLoading: manifestLoading,
    mutate: retryManifest,
  } = useSWR<MusicPlaylistManifest>(manifestKey, jsonFetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });

  const activeTracks = React.useMemo(
    () => Object.values(tracksByVersion).flat(),
    [tracksByVersion]
  );
  const currentTrack = React.useMemo(
    () =>
      trackId
        ? (activeTracks.find((track) => track.id === trackId) ?? null)
        : null,
    [activeTracks, trackId]
  );
  const activeVersion = React.useMemo(
    () =>
      versions.find(
        (version) => String(version.imageIndex) === String(versionId)
      ) ?? null,
    [versionId, versions]
  );
  const displayTitle = currentTrack
    ? musicTrackTitle(currentTrack, locale)
    : (activeVersion?.name ?? copy.playerLabel);
  const displayArtist = currentTrack
    ? musicTrackArtist(currentTrack, locale) || copy.unknownArtist
    : copy.panelDescription;
  const isPlaying = status === "playing";
  const showPause = isPlaying || playIntent;
  const progress =
    duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;

  const playerBottom = bottomBars > 0
    ? "calc(var(--batch-download-bar-height, 5rem) + var(--floating-bottom) + 0.75rem)"
    : "var(--floating-bottom)";

  const setPlaybackIntent = React.useCallback((nextIntent: boolean) => {
    playIntentRef.current = nextIntent;
    setPlayIntent(nextIntent);
  }, []);

  const persistSnapshot = React.useCallback(
    (time = currentTimeRef.current) => {
      if (!hydrated || restorePending || typeof window === "undefined") {
        return;
      }
      const state = useMusicPlayerStore.getState();
      const snapshot: StoredMusicPlayerSnapshot = {
        versionId: state.versionId,
        trackId: state.trackId,
        queue: state.queue,
        customQueue: state.customQueue,
        mode: state.mode,
        volume: state.volume,
        muted: state.muted,
        currentTime: time,
      };
      try {
        writeMusicPlayerSnapshot(window.localStorage, snapshot);
      } catch {
        // Accessing localStorage itself can throw before the writer runs.
      }
      lastCheckpointRef.current = Date.now();
    },
    [hydrated, restorePending]
  );

  React.useEffect(() => {
    if (hydrated) {
      return;
    }
    let persisted: StoredMusicPlayerSnapshot | null = null;
    try {
      if (typeof window !== "undefined") {
        persisted = readMusicPlayerSnapshot(window.localStorage);
      }
    } catch {
      // Continue without a saved playback position when storage is denied.
    }
    bootstrap(initialVersionId, initialTracks, persisted);
    if (persisted?.trackId && persisted.currentTime) {
      pendingSeekRef.current = {
        trackId: persisted.trackId,
        time: persisted.currentTime,
      };
      currentTimeRef.current = persisted.currentTime;
      // One-time device-local resume position.
      setCurrentTime(persisted.currentTime);
    }
  }, [bootstrap, hydrated, initialTracks, initialVersionId]);

  React.useEffect(() => {
    const audio = getOrCreateMusicPlayerAudio();
    audioRef.current = audio;
    if (!audio) {
      return;
    }

    const pendingTime = pendingSeekRef.current?.time;
    const nextTime =
      pendingTime ??
      (Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
    const nextDuration =
      Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : 0;
    currentTimeRef.current = nextTime;
    setCurrentTime(nextTime);
    setDuration(nextDuration);
    setPlaybackIntent(!audio.paused && !audio.ended);

    return () => {
      if (audioRef.current === audio) {
        audioRef.current = null;
      }
    };
  }, [setPlaybackIntent]);

  React.useEffect(() => {
    if (manifest) {
      loadManifest(manifest);
    }
  }, [loadManifest, manifest]);

  React.useEffect(() => {
    if (!hydrated) {
      return;
    }
    persistSnapshot();
  }, [
    hydrated,
    mode,
    muted,
    persistSnapshot,
    queue,
    trackId,
    versionId,
    volume,
  ]);

  React.useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!currentTrack) {
      audio.pause(); audio.removeAttribute("src"); delete audio.dataset.trackId; pendingSeekRef.current = null; audio.load();
      currentTimeRef.current = 0; setCurrentTime(0); setDuration(0);
      playIntentRef.current = false; setPlayIntent(false);
      return;
    }

    if (audio.dataset.trackId !== currentTrack.id) {
      audio.pause();
      audio.dataset.trackId = currentTrack.id;
      audio.src = currentTrack.audioUrl;
      audio.load();
      const pending = pendingSeekRef.current;
      let resumeAt = 0;
      if (pending?.trackId === currentTrack.id) {
        resumeAt = Math.max(0, pending.time);
        pendingSeekRef.current =
          resumeAt > 0 ? { trackId: currentTrack.id, time: resumeAt } : null;
      }
      currentTimeRef.current = resumeAt;
      setCurrentTime(resumeAt);
      setDuration(0);
    }
  }, [currentTrack]);

  React.useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.volume = volume;
    audio.muted = muted;
  }, [muted, volume]);

  React.useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const pauseForOtherMedia = () => {
      if (playIntentRef.current || !audio.paused) {
        setPlaybackIntent(false);
        audio.pause();
        setNotice(copy.pausedByOtherMedia);
        persistSnapshot();
      }
    };
    const handleNativePlay = (event: Event) => {
      if (
        event.target instanceof HTMLMediaElement &&
        event.target !== audio
      ) {
        pauseForOtherMedia();
      }
    };
    const handleCoordinatedPlay = (event: Event) => {
      const owner = (event as CustomEvent<MediaOwner>).detail;
      if (owner !== "global-music") {
        pauseForOtherMedia();
      }
    };

    document.addEventListener("play", handleNativePlay, true);
    window.addEventListener(MEDIA_PLAY_EVENT, handleCoordinatedPlay);
    return () => {
      document.removeEventListener("play", handleNativePlay, true);
      window.removeEventListener(MEDIA_PLAY_EVENT, handleCoordinatedPlay);
    };
  }, [copy.pausedByOtherMedia, persistSnapshot, setPlaybackIntent]);

  React.useEffect(() => {
    const checkpoint = () => persistSnapshot();
    const onVisibilityChange = () => {
      if (document.hidden) {
        checkpoint();
      }
    };
    window.addEventListener("pagehide", checkpoint);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", checkpoint);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [persistSnapshot]);

  const prepareTrack = React.useCallback(
    (track: MusicTrack, position = 0) => {
      const audio = audioRef.current;
      if (!audio) {
        return null;
      }

      if (audio.dataset.trackId !== track.id) {
        audio.pause();
        audio.dataset.trackId = track.id;
        audio.src = track.audioUrl;
        audio.load();
      }

      const target = Math.max(0, position);
      pendingSeekRef.current =
        target > 0 ? { trackId: track.id, time: target } : null;
      if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
        audio.currentTime = clampPlaybackTime(target, audio.duration);
        pendingSeekRef.current = null;
      }
      currentTimeRef.current = target;
      setCurrentTime(target);
      setDuration(
        Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : 0
      );
      return audio;
    },
    []
  );

  const beginPlayback = React.useCallback(
    (audio: HTMLAudioElement) => {
      document.querySelectorAll<HTMLMediaElement>("audio, video").forEach(
        (media) => {
          if (media !== audio && !media.paused) {
            media.pause();
          }
        }
      );
      setError(null);
      setNotice(null);
      setPlaybackIntent(true);
      setStatus("loading");
      void audio.play().catch(() => {
        setPlaybackIntent(false);
        setStatus("error");
        setError(copy.loadError);
      });
    },
    [copy.loadError, setError, setPlaybackIntent, setStatus]
  );

  const playTrack = React.useCallback(
    (track: MusicTrack, position = 0, shouldPlay = true) => {
      selectTrack(track.id);
      if (useMusicPlayerStore.getState().trackId !== track.id) return;
      failedTrackIdsRef.current.delete(track.id);
      const audio = prepareTrack(track, position);
      if (!audio) {
        return;
      }
      if (shouldPlay) {
        beginPlayback(audio);
      } else {
        setPlaybackIntent(false);
        audio.pause();
        setStatus("paused");
      }
    },
    [
      beginPlayback,
      prepareTrack,
      selectTrack,
      setPlaybackIntent,
      setStatus,
    ]
  );

  const adjacentTrackId = React.useCallback(
    (direction: 1 | -1, skipFailed = false) => {
      if (queue.length === 0) {
        return null;
      }
      const currentIndex = trackId ? queue.indexOf(trackId) : -1;
      for (let step = 1; step <= queue.length; step += 1) {
        const index =
          currentIndex < 0
            ? direction > 0
              ? 0
              : queue.length - 1
            : (currentIndex + direction * step + queue.length * 2) %
              queue.length;
        const candidate = queue[index];
        if (!skipFailed || !failedTrackIdsRef.current.has(candidate)) {
          return candidate;
        }
      }
      return null;
    },
    [queue, trackId]
  );

  const playTrackById = React.useCallback(
    (nextId: string | null, shouldPlay = true) => {
      if (!nextId) {
        return;
      }
      const track = activeTracks.find((candidate) => candidate.id === nextId);
      if (track) {
        playTrack(track, 0, shouldPlay);
      }
    },
    [activeTracks, playTrack]
  );

  const playPrevious = React.useCallback(() => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 5 && currentTrack) {
      prepareTrack(currentTrack, 0);
      if (!audio.paused) {
        beginPlayback(audio);
      }
      return;
    }
    playTrackById(adjacentTrackId(-1), true);
  }, [
    adjacentTrackId,
    beginPlayback,
    currentTrack,
    playTrackById,
    prepareTrack,
  ]);

  const playNext = React.useCallback(() => {
    playTrackById(adjacentTrackId(1), true);
  }, [adjacentTrackId, playTrackById]);

  const togglePlayback = React.useCallback(() => {
    if (!manifest) {
      setManifestRequested(true);
    }
    const audio = audioRef.current;
    if (!audio || !currentTrack || restorePending) {
      return;
    }

    if (playIntentRef.current || !audio.paused) {
      setPlaybackIntent(false);
      audio.pause();
      setStatus("paused");
      persistSnapshot();
      return;
    }

    const prepared = prepareTrack(currentTrack, currentTimeRef.current);
    if (prepared) {
      beginPlayback(prepared);
    }
  }, [
    beginPlayback,
    currentTrack,
    manifest,
    persistSnapshot,
    prepareTrack,
    restorePending,
    setPlaybackIntent,
    setStatus,
  ]);

  const seekTo = React.useCallback(
    (time: number) => {
      const audio = audioRef.current;
      if (!audio) {
        return;
      }
      const target = clampPlaybackTime(time, duration || audio.duration);
      audio.currentTime = target;
      currentTimeRef.current = target;
      setCurrentTime(target);
      persistSnapshot(target);
    },
    [duration, persistSnapshot]
  );

  // A "play this version" ask posted by /music. It carries only a version id,
  // and that version's tracks live in the lazily fetched manifest — so the
  // request usually has to survive a render or two until the SWR key above
  // (which the request itself switches on) delivers them. Clicking the same
  // version again arrives as a new token, which is what re-triggers this.
  React.useEffect(() => {
    if (!playRequest || !hydrated) {
      return;
    }
    const tracks = tracksByVersion[playRequest.versionId];
    if (!tracks || tracks.length === 0) {
      return;
    }
    clearPlayRequest();
    selectVersion(playRequest.versionId);
    const { trackId: selectedTrackId } = useMusicPlayerStore.getState();
    const track =
      tracks.find((candidate) => candidate.id === selectedTrackId) ?? tracks[0];
    // Driving the <audio> singleton from a one-shot cross-page intent; the state it touches mirrors that element.
    playTrack(track, 0, true);
  }, [
    clearPlayRequest,
    hydrated,
    playRequest,
    playTrack,
    selectVersion,
    tracksByVersion,
  ]);

  const cycleMode = React.useCallback(() => {
    const currentIndex = MODE_ORDER.indexOf(mode);
    setMode(MODE_ORDER[(currentIndex + 1) % MODE_ORDER.length]);
  }, [mode, setMode]);

  React.useEffect(() => {
    controlsRef.current = {
      play: () => {
        if (!playIntentRef.current) {
          togglePlayback();
        }
      },
      pause: () => {
        setPlaybackIntent(false);
        audioRef.current?.pause();
      },
      previous: playPrevious,
      next: playNext,
      seek: seekTo,
    };
  }, [
    playNext,
    playPrevious,
    seekTo,
    setPlaybackIntent,
    togglePlayback,
  ]);

  React.useEffect(() => {
    if (!("mediaSession" in navigator)) {
      return;
    }

    const actions: Array<
      [
        MediaSessionAction,
        MediaSessionActionHandler | null,
      ]
    > = [
      ["play", () => controlsRef.current.play()],
      ["pause", () => controlsRef.current.pause()],
      ["previoustrack", () => controlsRef.current.previous()],
      ["nexttrack", () => controlsRef.current.next()],
      [
        "seekbackward",
        (details) =>
          controlsRef.current.seek(
            currentTimeRef.current - (details.seekOffset ?? 10)
          ),
      ],
      [
        "seekforward",
        (details) =>
          controlsRef.current.seek(
            currentTimeRef.current + (details.seekOffset ?? 10)
          ),
      ],
      [
        "seekto",
        (details) => {
          if (details.seekTime !== undefined) {
            controlsRef.current.seek(details.seekTime);
          }
        },
      ],
    ];

    for (const [action, handler] of actions) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Unsupported actions are optional progressive enhancement.
      }
    }

    return () => {
      for (const [action] of actions) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          // Ignore unsupported actions during cleanup as well.
        }
      }
    };
  }, []);

  React.useEffect(() => {
    if (
      !("mediaSession" in navigator) ||
      !("MediaMetadata" in window) ||
      !currentTrack
    ) {
      return;
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: musicTrackTitle(currentTrack, locale),
      artist: musicTrackArtist(currentTrack, locale),
      album: currentTrack.versionName,
      artwork: currentTrack.coverUrl
        ? [{ src: currentTrack.coverUrl, type: "image/png" }]
        : [],
    });
  }, [currentTrack, locale]);

  React.useEffect(() => {
    if (!("mediaSession" in navigator)) {
      return;
    }
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  }, [isPlaying]);

  const updateMediaPosition = React.useCallback(
    (time: number, mediaDuration: number) => {
      if (
        !("mediaSession" in navigator) ||
        !Number.isFinite(mediaDuration) ||
        mediaDuration <= 0
      ) {
        return;
      }
      try {
        navigator.mediaSession.setPositionState({
          duration: mediaDuration,
          playbackRate: audioRef.current?.playbackRate ?? 1,
          position: clampPlaybackTime(time, mediaDuration),
        });
      } catch {
        // Some engines expose Media Session without position state support.
      }
    },
    []
  );

  const onAudioError = React.useCallback(() => {
    if (!trackId) {
      setPlaybackIntent(false);
      setStatus("error");
      setError(copy.loadError);
      return;
    }
    failedTrackIdsRef.current.add(trackId);
    if (playIntentRef.current) {
      const nextId = adjacentTrackId(1, true);
      if (nextId && nextId !== trackId) {
        playTrackById(nextId, true);
        return;
      }
    }
    setPlaybackIntent(false);
    setStatus("error");
    setError(copy.loadError);
  }, [
    adjacentTrackId,
    copy.loadError,
    playTrackById,
    setError,
    setPlaybackIntent,
    setStatus,
    trackId,
  ]);

  React.useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const handleLoadedMetadata = () => {
      const mediaDuration =
        Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : 0;
      setDuration(mediaDuration);
      const pending = pendingSeekRef.current;
      if (pending && pending.trackId === audio.dataset.trackId) {
        const target = clampPlaybackTime(pending.time, mediaDuration);
        audio.currentTime = target;
        currentTimeRef.current = target;
        setCurrentTime(target);
        pendingSeekRef.current = null;
      }
      if (status === "loading" && audio.paused) {
        setStatus("paused");
      }
      updateMediaPosition(audio.currentTime, mediaDuration);
    };
    const handleCanPlay = () => {
      if (status === "loading" && audio.paused) {
        setStatus("paused");
      }
    };
    const handlePlay = () => {
      document.querySelectorAll<HTMLMediaElement>("audio, video").forEach(
        (media) => {
          if (media !== audio && !media.paused) {
            media.pause();
          }
        }
      );
      failedTrackIdsRef.current.clear();
      setError(null);
      setNotice(null);
      setPlaybackIntent(true);
      setStatus("playing");
      announceMediaPlay("global-music");
    };
    const handlePlaying = () => setStatus("playing");
    const handlePause = () => {
      setPlaybackIntent(false);
      if (!audio.ended && status !== "error") {
        setStatus(currentTrack ? "paused" : "idle");
      }
      persistSnapshot(audio.currentTime);
    };
    const handleWaiting = () => {
      if (!audio.paused) {
        setStatus("loading");
      }
    };
    const handleDurationChange = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };
    const handleTimeUpdate = () => {
      currentTimeRef.current = audio.currentTime;
      setCurrentTime(audio.currentTime);
      updateMediaPosition(audio.currentTime, audio.duration);
      if (
        Date.now() - lastCheckpointRef.current >= CHECKPOINT_INTERVAL_MS
      ) {
        persistSnapshot(audio.currentTime);
      }
    };
    const handleEnded = () => {
      if (mode === "repeat-one" && currentTrack) {
        playTrack(currentTrack, 0, true);
        return;
      }
      playTrackById(nextTrackId(), true);
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("canplay", handleCanPlay);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("playing", handlePlaying);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("waiting", handleWaiting);
    audio.addEventListener("durationchange", handleDurationChange);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", onAudioError);

    return () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("canplay", handleCanPlay);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("playing", handlePlaying);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("waiting", handleWaiting);
      audio.removeEventListener("durationchange", handleDurationChange);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", onAudioError);
    };
  }, [
    currentTrack,
    mode,
    nextTrackId,
    onAudioError,
    persistSnapshot,
    playTrack,
    playTrackById,
    setError,
    setPlaybackIntent,
    setStatus,
    status,
    updateMediaPosition,
  ]);

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          setLibraryOpen(false);
          setManifestRequested(true);
        }
      }}
    >
      <div
        ref={surfaceRef}
        data-music-player-root
        role="region"
        aria-label={copy.playerLabel}
        inert={open || undefined}
        className={cn(
          "pointer-events-none fixed z-50",
          collapsed
            ? "left-3 md:left-4"
            : "inset-x-3 md:right-auto md:left-4 md:w-[22rem]"
        )}
        // Own view-transition-name = pinned during page transitions (see
        // globals.css) instead of blinking with the root snapshot.
        style={{ bottom: playerBottom, viewTransitionName: "music-player", opacity: open ? 0 : 1 }}
      >
        <AnimatePresence initial={false} mode="popLayout">
        {collapsed ? (
          <MotionSurface as="button" pattern="reveal"
            key="collapsed"
            layoutId={reducedMotion ? undefined : layoutId}
            whileTap={getPressTarget(reducedMotion)}
            type="button"
            data-music-player-surface="collapsed"

            initial={false}
            transition={getSemanticTransition("layout", reducedMotion)}
            ref={expandTriggerRef}
            onClick={() => { setLibraryOpen(false); setOpen(true); setManifestRequested(true); }}
            aria-label={copy.expand}
            title={copy.expand}
            className="pointer-events-auto relative block size-12 rounded-full border border-border/70 bg-popover/95 shadow-xl ring-1 ring-foreground/5 backdrop-blur-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {/* Vinyl-style disc: the artwork spins while playing so the
                bubble reads as a music player at a glance. */}
            <span
              aria-hidden="true"
              data-motion-loop="disc"
              className="absolute inset-0 overflow-hidden rounded-full"
              style={{ animation: "adx-ambient-disc var(--adx-motion-ambient-disc-duration) linear infinite", animationPlayState: isPlaying && motionActive ? "running" : "paused" }}
            >
              <PlayerArtwork
                track={currentTrack}
                versionId={versionId}
                alt=""
                className="size-full p-2"
              />
            </span>
            {currentTrack && duration > 0 ? (
              <ProgressRing progress={progress} className="text-primary" />
            ) : null}
            {/* The note badge is what says "music player" even while idle. */}
            <span
              aria-hidden="true"
              className="absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background"
            >
              <Music2Icon className="size-3" />
            </span>
          </MotionSurface>
        ) : (
        <MotionSurface as="div" pattern="reveal"
          key="expanded"
          layoutId={reducedMotion ? undefined : layoutId}
          data-music-player-surface="expanded"

          initial={false}
          transition={getSemanticTransition("layout", reducedMotion)}
          className="pointer-events-auto relative isolate overflow-hidden rounded-2xl border border-border/70 bg-popover/95 shadow-xl ring-1 ring-foreground/5 backdrop-blur-xl"
        >
          <div className="flex min-h-16 items-center gap-1 p-2">
            <div className="relative mr-1 size-12 shrink-0 overflow-hidden rounded-xl bg-muted ring-1 ring-border/60">
              <PlayerArtwork
                track={currentTrack}
                versionId={versionId}
                alt=""
                className="size-full"
              />
            </div>

            <div className="min-w-0 flex-1">
              {/* Scrolls to show a long title while it plays; ellipsized otherwise. */}
              <ScrollingLabel
                text={displayTitle}
                active={isPlaying}
                className="text-sm font-medium"
              />
              <p
                aria-live={notice || error ? "polite" : undefined}
                className="truncate text-xs text-muted-foreground"
                title={displayArtist}
              >
                {notice ?? error ?? displayArtist}
              </p>
            </div>

            {/* 44px target; the filled disc sits inside the progress ring. */}
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              onClick={togglePlayback}
              disabled={!hydrated || !currentTrack || restorePending}
              aria-label={showPause ? copy.pause : copy.play}
              title={showPause ? copy.pause : copy.play}
              className="group/play relative size-11 rounded-full text-primary hover:bg-transparent"
            >
              {currentTrack && duration > 0 ? <ProgressRing progress={progress} /> : null}
              <span className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-colors group-hover/play:bg-primary/85 [&>svg]:size-4">
                {restorePending ? (
                  <LoaderCircleIcon data-motion-sensitive className="animate-spin" />
                ) : showPause ? (
                  <PauseIcon className="fill-current" />
                ) : (
                  <PlayIcon className="fill-current" />
                )}
              </span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              onClick={playNext}
              disabled={!currentTrack || queue.length < 2}
              aria-label={copy.next}
              title={copy.next}
              className="hidden size-10 sm:inline-flex"
            >
              <SkipForwardIcon className="fill-current" />
            </Button>
            <DialogPrimitive.Trigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                aria-label={copy.openPlaylist}
                ref={playlistTriggerRef}
                title={copy.openPlaylist}
                className="size-10"
              >
                <ListMusicIcon />
              </Button>
            </DialogPrimitive.Trigger>
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              onClick={() => {
                setOpen(false);
                setCollapsed(true);
              }}
              aria-label={copy.collapse}
              title={copy.collapse}
              className="size-10"
            >
              <ChevronDownIcon />
            </Button>
          </div>
        </MotionSurface>
        )}
        </AnimatePresence>
      </div>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[79] bg-background" />
        <DialogPrimitive.Content
          data-music-player-panel
          data-library-open={libraryOpen}
          style={coverPaletteStyle(currentTrack?.palette)}
          onEscapeKeyDown={() => { returnPanelFocus.current = true; }}
          onCloseAutoFocus={(event) => {
            if (returnPanelFocus.current) {
              event.preventDefault();
              returnPanelFocus.current = false;
              requestAnimationFrame(() => (collapsed ? expandTriggerRef.current : playlistTriggerRef.current)?.focus());
            }
          }}
          aria-label={copy.panelTitle}
          data-motion-sensitive
          data-motion-surface="dialog"
          aria-describedby={undefined}
          className="music-player-immersive adx-material fixed inset-0 z-[80] grid h-dvh w-full overflow-hidden bg-background outline-none"
        >
          <CoverPaletteBackdrop palette={currentTrack?.palette} />
          <div className="music-player-heading"><DialogPrimitive.Title className="text-sm font-medium text-muted-foreground">{copy.panelTitle}</DialogPrimitive.Title>
          <Button type="button" variant="ghost" size="icon-touch" aria-label={copy.closePanel} onClick={() => { returnPanelFocus.current = true; setOpen(false); }}><XIcon /></Button></div>
          <div className="music-player-stage">
          <div className="music-player-now">
          <div className="music-player-identity">
            <div className="music-player-track">
              <div className="music-player-artwork overflow-hidden rounded bg-muted shadow-lg ring-1 ring-border/60">
                <PlayerArtwork
                  track={currentTrack}
                  versionId={versionId}
                  alt=""
                  className="size-full"
                />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="music-player-title font-semibold">
                  <ScrollingLabel text={displayTitle} active={isPlaying} />
                </h2>
                <p
                  className="truncate text-sm text-muted-foreground"
                  title={displayArtist}
                >
                  {displayArtist}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {activeVersion?.name ?? copy.panelTitle}
                  {queue.length > 0
                    ? ` · ${copy.trackCount(queue.length)}`
                    : null}
                </p>
              </div>
            </div>

          </div>

          <div className="music-player-transport">
            <PlayerSlider
              value={currentTime}
              // Radix needs max > min; a zero duration means nothing to seek.
              max={duration > 0 ? duration : 1}
              step={0.1}
              onValueChange={seekTo}
              disabled={!currentTrack || duration <= 0}
              label={copy.seek}
              valueText={`${formatPlaybackTime(currentTime)} / ${formatPlaybackTime(duration)}`}
            />
            <div className="flex justify-between text-[0.7rem] tabular-nums text-muted-foreground">
              <span>{formatPlaybackTime(currentTime)}</span>
              <span>{formatPlaybackTime(duration)}</span>
            </div>
            <div className="mt-1 flex items-center justify-center gap-3">
              <Button
                type="button"
                variant="ghost"
                size="icon-touch"
                onClick={playPrevious}
                disabled={!currentTrack}
                aria-label={copy.previous}
                title={copy.previous}
              >
                <SkipBackIcon className="fill-current" />
              </Button>
              <Button
                type="button"
                size="icon-touch"
                onClick={togglePlayback}
                disabled={!currentTrack || restorePending}
                aria-label={showPause ? copy.pause : copy.play}
                title={showPause ? copy.pause : copy.play}
                variant="ghost"
                className="music-player-play size-16 [&_svg:not([class*='size-'])]:size-9"
              >
                {restorePending ? (
                  <LoaderCircleIcon data-motion-sensitive className="animate-spin" />
                ) : showPause ? (
                  <PauseIcon className="fill-current" />
                ) : (
                  <PlayIcon className="fill-current" />
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-touch"
                onClick={playNext}
                disabled={!currentTrack}
                aria-label={copy.next}
                title={copy.next}
              >
                <SkipForwardIcon className="fill-current" />
              </Button>
            </div>
          </div>

          </div>
          <div className="music-player-library" id={libraryPanelId} hidden={!libraryOpen}>
          {manifestLoading && !manifest ? <p role="status" className="p-4 text-sm">{copy.loading}</p> : manifestError ? <div className="p-4 text-sm"><p>{copy.loadError}</p><Button variant="outline" size="touch" onClick={() => void retryManifest()}>{copy.retry}</Button></div> : <MusicLibraryPanel locale={locale} onPlay={playTrack} />}

          </div>
          </div>
          <div className="music-player-footer flex items-center gap-2 border-t border-border/60">
            <Button
              type="button"
              variant="ghost"
              size="icon-touch"
              onClick={() => setMuted(!muted)}
              aria-label={muted ? copy.unmute : copy.mute}
              title={muted ? copy.unmute : copy.mute}
            >
              {muted || volume === 0 ? <VolumeXIcon /> : <Volume2Icon />}
            </Button>
            <PlayerSlider
              value={muted ? 0 : volume}
              max={1}
              step={0.05}
              onValueChange={(next) => {
                setVolume(next);
                setMuted(false);
              }}
              label={copy.volume}
              valueText={`${Math.round((muted ? 0 : volume) * 100)}%`}
              className="min-w-0 flex-1"
            />
            <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">
              {Math.round((muted ? 0 : volume) * 100)}%
            </span>
            <Button type="button" variant="ghost" size="icon-touch" aria-label={copy.openPlaylist} aria-expanded={libraryOpen} aria-controls={libraryPanelId} onClick={() => setLibraryOpen((value) => !value)} className={cn("music-player-queue-toggle", libraryOpen && "bg-white/15")}><ListMusicIcon /></Button>
            {/* Play mode: one labelled control (it used to be an unlabelled
                icon up in the transport plus loose text here). Tinted while
                it is anything but plain sequential play. */}
            <Button
              type="button"
              variant="ghost"
              size="touch"
              onClick={cycleMode}
              aria-label={copy.modeHint[mode]}
              title={copy.modeHint[mode]}
              className={cn(
                "shrink-0 rounded-full px-2.5 text-xs",
                mode === "sequence"
                  ? "text-muted-foreground"
                  : "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
              )}
            >
              <PlaybackModeIcon mode={mode} />
              {copy.mode[mode]}
            </Button>
          </div>

        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
