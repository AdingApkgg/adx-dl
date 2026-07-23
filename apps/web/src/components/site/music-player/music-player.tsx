"use client";

import * as React from "react";
import {
  AlertCircleIcon,
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
} from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import useSWR from "swr";
import { useShallow } from "zustand/react/shallow";

import { motion, useReducedMotion } from "@/components/motion";
import { CompatibleImage } from "@/components/site/compatible-image";
import { useDownloadsStore } from "@/components/site/downloads/downloads-store";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { VersionGroup } from "@/lib/catalog-shared";
import { type Locale } from "@/lib/i18n";
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
import { cn } from "@/lib/utils";
import { versionImageSourcesByIndex } from "@/lib/version-image";

import { getOrCreateMusicPlayerAudio } from "./music-player-audio";
import { getMusicPlayerCopy } from "./music-player-copy";
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
      className={cn("object-cover", className)}
    />
  );
}

function PlaybackModeIcon({ mode }: { mode: MusicPlayerMode }) {
  if (mode === "shuffle") {
    return <ShuffleIcon />;
  }
  if (mode === "repeat-one") {
    return <Repeat1Icon />;
  }
  return <Repeat2Icon />;
}

export function MusicPlayer({
  locale,
  versions,
  initialVersionId,
  initialTracks,
}: MusicPlayerProps) {
  const copy = getMusicPlayerCopy(locale);
  const reducedMotion = useReducedMotion();
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
    }))
  );

  const needsPersistedManifest = hydrated && restorePending;
  const manifestKey =
    manifestRequested || open || needsPersistedManifest
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
    () => (versionId ? (tracksByVersion[versionId] ?? []) : []),
    [tracksByVersion, versionId]
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
    ? "calc(var(--batch-download-bar-height, 5rem) + max(1rem, env(safe-area-inset-bottom)) + 0.75rem)"
    : "max(1rem, env(safe-area-inset-bottom))";

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
        mode: state.mode,
        volume: state.volume,
        muted: state.muted,
        currentTime: time,
      };
      writeMusicPlayerSnapshot(window.localStorage, snapshot);
      lastCheckpointRef.current = Date.now();
    },
    [hydrated, restorePending]
  );

  React.useEffect(() => {
    if (hydrated) {
      return;
    }
    const persisted =
      typeof window === "undefined"
        ? null
        : readMusicPlayerSnapshot(window.localStorage);
    bootstrap(initialVersionId, initialTracks, persisted);
    if (persisted?.trackId && persisted.currentTime) {
      pendingSeekRef.current = {
        trackId: persisted.trackId,
        time: persisted.currentTime,
      };
      currentTimeRef.current = persisted.currentTime;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time device-local resume position
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
    if (!audio || !currentTrack) {
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

  const changeVersion = React.useCallback(
    (nextVersionId: string) => {
      const shouldContinue = playIntentRef.current;
      selectVersion(nextVersionId);
      const state = useMusicPlayerStore.getState();
      const nextTrack = state.trackId
        ? state.tracksByVersion[nextVersionId]?.find(
            (track) => track.id === state.trackId
          )
        : null;
      if (nextTrack) {
        playTrack(nextTrack, 0, shouldContinue);
      }
    },
    [playTrack, selectVersion]
  );

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

  const selectedVersionId =
    versionId && versions.some(
      (version) => String(version.imageIndex) === versionId
    )
      ? versionId
      : String(initialVersionId);

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          setManifestRequested(true);
        }
      }}
    >
      <div
        aria-label={copy.playerLabel}
        className="pointer-events-none fixed inset-x-3 z-50 md:right-auto md:left-4 md:w-[22rem]"
        style={{ bottom: playerBottom }}
      >
        <motion.div
          initial={reducedMotion ? false : { y: 16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="pointer-events-auto relative isolate overflow-hidden rounded-2xl border border-border/70 bg-popover/95 shadow-xl ring-1 ring-foreground/5 backdrop-blur-xl"
        >
          <div
            aria-hidden="true"
            data-motion-sensitive
            className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary transition-transform duration-200"
            style={{ transform: `scaleX(${progress})` }}
          />
          <div className="flex min-h-16 items-center gap-2 p-2">
            <div className="relative size-12 shrink-0 overflow-hidden rounded-xl bg-muted ring-1 ring-border/60">
              <PlayerArtwork
                track={currentTrack}
                versionId={versionId}
                alt=""
                className="size-full"
              />
              {isPlaying && !reducedMotion ? (
                <motion.span
                  aria-hidden="true"
                  className="absolute inset-0 rounded-xl ring-2 ring-inset ring-primary/70"
                  animate={{ opacity: [0.25, 0.85, 0.25] }}
                  transition={{ duration: 1.8, repeat: Infinity }}
                />
              ) : null}
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium" title={displayTitle}>
                {displayTitle}
              </p>
              <p
                aria-live={notice || error ? "polite" : undefined}
                className="truncate text-xs text-muted-foreground"
                title={displayArtist}
              >
                {notice ?? error ?? displayArtist}
              </p>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              onClick={togglePlayback}
              disabled={!hydrated || !currentTrack || restorePending}
              aria-label={showPause ? copy.pause : copy.play}
              title={showPause ? copy.pause : copy.play}
              className="size-10 rounded-full bg-primary text-primary-foreground hover:bg-primary/85 hover:text-primary-foreground"
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
              size="icon-lg"
              onClick={playNext}
              disabled={!currentTrack || queue.length < 2}
              aria-label={copy.next}
              title={copy.next}
              className="hidden size-10 sm:inline-flex"
            >
              <SkipForwardIcon className="fill-current" />
            </Button>
            <PopoverPrimitive.Trigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                aria-label={copy.openPlaylist}
                title={copy.openPlaylist}
                className="size-10"
              >
                <ListMusicIcon />
              </Button>
            </PopoverPrimitive.Trigger>
          </div>
        </motion.div>
      </div>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="top"
          align="end"
          sideOffset={10}
          collisionPadding={12}
          aria-label={copy.panelTitle}
          data-motion-sensitive
          className="z-[55] flex max-h-[min(72dvh,36rem)] w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-border/70 bg-popover/98 shadow-2xl ring-1 ring-foreground/5 backdrop-blur-xl outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div className="border-b border-border/60 p-4">
            <div className="flex items-start gap-3 pr-8">
              <div className="size-14 shrink-0 overflow-hidden rounded-xl bg-muted ring-1 ring-border/60">
                <PlayerArtwork
                  track={currentTrack}
                  versionId={versionId}
                  alt=""
                  className="size-full"
                />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-semibold" title={displayTitle}>
                  {displayTitle}
                </h2>
                <p
                  className="truncate text-sm text-muted-foreground"
                  title={displayArtist}
                >
                  {displayArtist}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {activeVersion?.name ?? copy.panelTitle}
                  {activeTracks.length > 0
                    ? ` · ${copy.trackCount(activeTracks.length)}`
                    : null}
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <label
                htmlFor="music-version-select"
                className="shrink-0 text-xs font-medium text-muted-foreground"
              >
                {copy.versionLabel}
              </label>
              <Select
                value={selectedVersionId}
                onValueChange={changeVersion}
                disabled={!manifest}
              >
                <SelectTrigger
                  id="music-version-select"
                  size="sm"
                  className="min-w-0 flex-1"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  align="end"
                  className="z-[56] max-h-72"
                >
                  {versions.map((version) =>
                    version.imageIndex !== null ? (
                      <SelectItem
                        key={version.slug}
                        value={String(version.imageIndex)}
                      >
                        <span className="truncate">{version.name}</span>
                        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                          {copy.trackCount(version.count)}
                        </span>
                      </SelectItem>
                    ) : null
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="border-b border-border/60 px-4 py-3">
            <input
              type="range"
              min={0}
              max={Math.max(duration, 0)}
              step={0.1}
              value={Math.min(currentTime, Math.max(duration, 0))}
              onChange={(event) => seekTo(Number(event.target.value))}
              disabled={!currentTrack || duration <= 0}
              aria-label={copy.seek}
              aria-valuetext={`${formatPlaybackTime(currentTime)} / ${formatPlaybackTime(duration)}`}
              className="h-1.5 w-full cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50"
            />
            <div className="mt-1 flex justify-between text-[0.7rem] tabular-nums text-muted-foreground">
              <span>{formatPlaybackTime(currentTime)}</span>
              <span>{formatPlaybackTime(duration)}</span>
            </div>
            <div className="mt-2 flex items-center justify-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                onClick={playPrevious}
                disabled={!currentTrack}
                aria-label={copy.previous}
                title={copy.previous}
              >
                <SkipBackIcon className="fill-current" />
              </Button>
              <Button
                type="button"
                size="icon-lg"
                onClick={togglePlayback}
                disabled={!currentTrack || restorePending}
                aria-label={showPause ? copy.pause : copy.play}
                title={showPause ? copy.pause : copy.play}
                className="size-11 rounded-full"
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
                size="icon-lg"
                onClick={playNext}
                disabled={!currentTrack}
                aria-label={copy.next}
                title={copy.next}
              >
                <SkipForwardIcon className="fill-current" />
              </Button>
              <Button
                type="button"
                variant={mode === "sequence" ? "ghost" : "secondary"}
                size="icon-lg"
                onClick={cycleMode}
                aria-label={copy.modeHint[mode]}
                title={copy.modeHint[mode]}
              >
                <PlaybackModeIcon mode={mode} />
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
            {manifestLoading && !manifest ? (
              <div
                role="status"
                className="flex min-h-36 items-center justify-center gap-2 text-sm text-muted-foreground"
              >
                <LoaderCircleIcon
                  data-motion-sensitive
                  className="size-4 animate-spin"
                />
                {copy.loading}
              </div>
            ) : manifestError && !manifest ? (
              <div
                role="alert"
                className="flex min-h-36 flex-col items-center justify-center gap-3 px-6 text-center text-sm"
              >
                <AlertCircleIcon className="size-5 text-destructive" />
                <span>{copy.loadError}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void retryManifest()}
                >
                  {copy.retry}
                </Button>
              </div>
            ) : activeTracks.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                {copy.noTracks}
              </p>
            ) : (
              <ol aria-label={copy.panelTitle} className="flex flex-col gap-0.5">
                {activeTracks.map((track, index) => {
                  const selected = track.id === trackId;
                  const title = musicTrackTitle(track, locale);
                  const artist =
                    musicTrackArtist(track, locale) || copy.unknownArtist;
                  return (
                    <li key={track.id}>
                      <button
                        type="button"
                        onClick={() => playTrack(track)}
                        aria-current={selected ? "true" : undefined}
                        className={cn(
                          "group/track flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                          selected && "bg-primary/10 text-primary"
                        )}
                      >
                        <span className="flex size-7 shrink-0 items-center justify-center text-xs tabular-nums text-muted-foreground">
                          {selected && isPlaying ? (
                            <Music2Icon className="size-4" aria-hidden="true" />
                          ) : (
                            index + 1
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {title}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {artist}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          <div className="flex items-center gap-2 border-t border-border/60 px-4 py-3">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setMuted(!muted)}
              aria-label={muted ? copy.unmute : copy.mute}
              title={muted ? copy.unmute : copy.mute}
            >
              {muted || volume === 0 ? <VolumeXIcon /> : <Volume2Icon />}
            </Button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(event) => {
                setVolume(Number(event.target.value));
                setMuted(false);
              }}
              aria-label={copy.volume}
              className="h-1.5 flex-1 cursor-pointer accent-primary"
            />
            <span className="min-w-10 text-right text-xs tabular-nums text-muted-foreground">
              {Math.round((muted ? 0 : volume) * 100)}%
            </span>
            <span className="max-w-24 truncate text-xs text-muted-foreground">
              {copy.mode[mode]}
            </span>
          </div>

          <PopoverPrimitive.Arrow className="fill-border" />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
