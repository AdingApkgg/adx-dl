import { create } from "zustand";

import type { MusicTrack } from "@/lib/music-playlists";

export type MusicPlayerMode = "sequence" | "shuffle" | "repeat-one";

export type MusicPlayerStatus =
  | "idle"
  | "loading"
  | "paused"
  | "playing"
  | "error";

export type MusicTracksByVersion = Record<string, MusicTrack[]>;

export type MusicPlayerPersistedSnapshot = {
  versionId?: string | null;
  trackId?: string | null;
  queue?: readonly string[];
  mode?: MusicPlayerMode;
  volume?: number;
  muted?: boolean;
};

export type MusicPlayerManifestInput =
  | Readonly<Record<string, readonly MusicTrack[]>>
  | {
      playlists: Readonly<Record<string, readonly MusicTrack[]>>;
    };

export type MusicPlayerState = {
  tracksByVersion: MusicTracksByVersion;
  versionId: string | null;
  trackId: string | null;
  queue: string[];
  mode: MusicPlayerMode;
  status: MusicPlayerStatus;
  volume: number;
  muted: boolean;
  error: string | null;
  hydrated: boolean;
  restorePending: boolean;
};

export type MusicPlayerActions = {
  bootstrap: (
    initialVersionId: string | number,
    initialTracks: readonly MusicTrack[],
    persisted?: MusicPlayerPersistedSnapshot | null
  ) => void;
  loadManifest: (manifest: MusicPlayerManifestInput) => void;
  selectVersion: (versionId: string | number) => void;
  selectTrack: (trackId: string) => void;
  setMode: (mode: MusicPlayerMode) => void;
  /** Returns the next queue id without changing the current selection. */
  nextTrackId: () => string | null;
  /** Returns the previous queue id without changing the current selection. */
  previousTrackId: () => string | null;
  setStatus: (status: MusicPlayerStatus) => void;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
  setError: (error: string | null) => void;
};

export type MusicPlayerStore = MusicPlayerState & MusicPlayerActions;

export type MusicPlayerRandom = () => number;

const DEFAULT_VOLUME = 0.72;

const INITIAL_STATE: MusicPlayerState = {
  tracksByVersion: {},
  versionId: null,
  trackId: null,
  queue: [],
  mode: "sequence",
  status: "idle",
  volume: DEFAULT_VOLUME,
  muted: false,
  error: null,
  hydrated: false,
  restorePending: false,
};

function boundedRandom(random: MusicPlayerRandom): number {
  const value = random();
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(Math.max(value, 0), 1 - Number.EPSILON);
}

/**
 * Return a shuffled copy. The input is never mutated, and an injected random
 * source makes queue construction deterministic in tests.
 */
export function fisherYatesShuffle<T>(
  values: readonly T[],
  random: MusicPlayerRandom = Math.random
): T[] {
  const shuffled = [...values];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(boundedRandom(random) * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }

  return shuffled;
}

function uniqueTracks(tracks: readonly MusicTrack[]): MusicTrack[] {
  const seen = new Set<string>();
  const unique: MusicTrack[] = [];

  for (const track of tracks) {
    if (!track.id || seen.has(track.id)) {
      continue;
    }
    seen.add(track.id);
    unique.push(track);
  }

  return unique;
}

export function stableTrackIds(tracks: readonly MusicTrack[]): string[] {
  return uniqueTracks(tracks).map((track) => track.id);
}

/**
 * Build a queue from stable track ids. In shuffle mode an available current
 * track stays first, so changing modes never changes the playing selection and
 * the following item is genuinely shuffled.
 */
export function buildMusicPlayerQueue(
  tracks: readonly MusicTrack[],
  mode: MusicPlayerMode,
  currentTrackId: string | null,
  random: MusicPlayerRandom = Math.random
): string[] {
  const trackIds = stableTrackIds(tracks);

  if (mode !== "shuffle") {
    return trackIds;
  }

  if (currentTrackId && trackIds.includes(currentTrackId)) {
    return [
      currentTrackId,
      ...fisherYatesShuffle(
        trackIds.filter((trackId) => trackId !== currentTrackId),
        random
      ),
    ];
  }

  return fisherYatesShuffle(trackIds, random);
}

function reconcilePersistedShuffleQueue(
  tracks: readonly MusicTrack[],
  persistedQueue: readonly string[] | undefined,
  random: MusicPlayerRandom
): string[] | null {
  if (!persistedQueue) {
    return null;
  }

  const availableIds = stableTrackIds(tracks);
  const available = new Set(availableIds);
  const seen = new Set<string>();
  const reconciled: string[] = [];

  for (const trackId of persistedQueue) {
    if (!available.has(trackId) || seen.has(trackId)) {
      continue;
    }
    seen.add(trackId);
    reconciled.push(trackId);
  }

  const missing = availableIds.filter((trackId) => !seen.has(trackId));
  return [...reconciled, ...fisherYatesShuffle(missing, random)];
}

export function nextMusicTrackId(
  queue: readonly string[],
  currentTrackId: string | null,
  mode: MusicPlayerMode
): string | null {
  if (queue.length === 0) {
    return null;
  }
  if (mode === "repeat-one" && currentTrackId && queue.includes(currentTrackId)) {
    return currentTrackId;
  }

  const currentIndex = currentTrackId ? queue.indexOf(currentTrackId) : -1;
  return currentIndex < 0 ? queue[0] : queue[(currentIndex + 1) % queue.length];
}

export function previousMusicTrackId(
  queue: readonly string[],
  currentTrackId: string | null,
  mode: MusicPlayerMode
): string | null {
  if (queue.length === 0) {
    return null;
  }
  if (mode === "repeat-one" && currentTrackId && queue.includes(currentTrackId)) {
    return currentTrackId;
  }

  const currentIndex = currentTrackId ? queue.indexOf(currentTrackId) : -1;
  return currentIndex < 0
    ? queue[0]
    : queue[(currentIndex - 1 + queue.length) % queue.length];
}

function normalizeVolume(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, 0), 1);
}

function normalizeVersionId(versionId: string | number | null | undefined) {
  if (versionId === null || versionId === undefined) {
    return null;
  }
  const normalized = String(versionId);
  return normalized.length > 0 ? normalized : null;
}

function isMusicPlayerMode(value: unknown): value is MusicPlayerMode {
  return value === "sequence" || value === "shuffle" || value === "repeat-one";
}

function isManifestEnvelope(
  manifest: MusicPlayerManifestInput
): manifest is {
  playlists: Readonly<Record<string, readonly MusicTrack[]>>;
} {
  const playlists = (
    manifest as {
      playlists?: unknown;
    }
  ).playlists;
  return (
    typeof playlists === "object" &&
    playlists !== null &&
    !Array.isArray(playlists)
  );
}

function manifestPlaylists(
  manifest: MusicPlayerManifestInput
): Readonly<Record<string, readonly MusicTrack[]>> {
  if (isManifestEnvelope(manifest)) {
    return manifest.playlists;
  }
  return manifest;
}

function normalizeTracksByVersion(
  playlists: Readonly<Record<string, readonly MusicTrack[]>>
): MusicTracksByVersion {
  return Object.fromEntries(
    Object.entries(playlists).map(([versionId, tracks]) => [
      String(versionId),
      uniqueTracks(tracks),
    ])
  );
}

function firstVersionId(tracksByVersion: MusicTracksByVersion): string | null {
  const versionIds = Object.keys(tracksByVersion);
  return (
    versionIds.find((versionId) => tracksByVersion[versionId].length > 0) ??
    versionIds[0] ??
    null
  );
}

function hasVersion(
  tracksByVersion: MusicTracksByVersion,
  versionId: string | null
): versionId is string {
  return (
    versionId !== null &&
    Object.prototype.hasOwnProperty.call(tracksByVersion, versionId)
  );
}

function availableTrackId(
  tracks: readonly MusicTrack[],
  preferredTrackId: string | null | undefined
): string | null {
  if (
    preferredTrackId &&
    tracks.some((track) => track.id === preferredTrackId)
  ) {
    return preferredTrackId;
  }
  return tracks[0]?.id ?? null;
}

function playbackStatusAfterSelection(
  prior: MusicPlayerState,
  versionId: string | null,
  trackId: string | null
): MusicPlayerStatus {
  if (versionId === prior.versionId && trackId === prior.trackId) {
    return prior.status;
  }
  return trackId ? "loading" : "idle";
}

export function createMusicPlayerStore(
  random: MusicPlayerRandom = Math.random
) {
  // A persisted version may not be present in the SSR-provided initial
  // playlist. Hold that preference until the complete manifest arrives.
  let pendingBootstrapSnapshot: MusicPlayerPersistedSnapshot | null = null;

  return create<MusicPlayerStore>()((set, get) => ({
    ...INITIAL_STATE,

    bootstrap: (initialVersionId, initialTracks, persisted) => {
      // Route transitions may replace a locale/layout subtree while keeping
      // the client runtime alive. The global player store is process-wide, so
      // a remounted UI must attach to the active session instead of resetting
      // it from the server-provided starter track.
      if (get().hydrated) {
        return;
      }

      const normalizedInitialVersionId =
        normalizeVersionId(initialVersionId) ?? String(initialVersionId);
      const tracksByVersion = normalizeTracksByVersion({
        [normalizedInitialVersionId]: initialTracks,
      });
      const persistedVersionId = normalizeVersionId(persisted?.versionId);
      const versionId = hasVersion(tracksByVersion, persistedVersionId)
        ? persistedVersionId
        : normalizedInitialVersionId;
      const tracks = tracksByVersion[versionId] ?? [];
      const trackId = availableTrackId(tracks, persisted?.trackId);
      const mode = isMusicPlayerMode(persisted?.mode)
        ? persisted.mode
        : INITIAL_STATE.mode;
      const persistedQueue =
        mode === "shuffle" && persistedVersionId === versionId
          ? reconcilePersistedShuffleQueue(tracks, persisted?.queue, random)
          : null;

      const persistedTrackIsAvailable =
        !persisted?.trackId || trackId === persisted.trackId;
      pendingBootstrapSnapshot =
        persistedVersionId &&
        (persistedVersionId !== versionId || !persistedTrackIsAvailable)
          ? persisted ?? null
          : null;

      set({
        tracksByVersion,
        versionId,
        trackId,
        queue:
          persistedQueue ??
          buildMusicPlayerQueue(tracks, mode, trackId, random),
        mode,
        status: "idle",
        volume: normalizeVolume(persisted?.volume, INITIAL_STATE.volume),
        muted:
          typeof persisted?.muted === "boolean"
            ? persisted.muted
            : INITIAL_STATE.muted,
        error: null,
        hydrated: true,
        restorePending: pendingBootstrapSnapshot !== null,
      });
    },

    loadManifest: (manifest) => {
      const tracksByVersion = normalizeTracksByVersion(
        manifestPlaylists(manifest)
      );
      const prior = get();
      const pendingVersionId = normalizeVersionId(
        pendingBootstrapSnapshot?.versionId
      );
      const versionId = hasVersion(tracksByVersion, pendingVersionId)
        ? pendingVersionId
        : hasVersion(tracksByVersion, prior.versionId)
          ? prior.versionId
          : firstVersionId(tracksByVersion);
      const tracks = versionId ? (tracksByVersion[versionId] ?? []) : [];
      const preferredTrackId =
        pendingVersionId === versionId
          ? pendingBootstrapSnapshot?.trackId
          : prior.trackId;
      const trackId = availableTrackId(tracks, preferredTrackId);
      const persistedQueue =
        prior.mode === "shuffle" && pendingVersionId === versionId
          ? reconcilePersistedShuffleQueue(
              tracks,
              pendingBootstrapSnapshot?.queue,
              random
            )
          : null;

      pendingBootstrapSnapshot = null;
      set({
        tracksByVersion,
        versionId,
        trackId,
        queue:
          persistedQueue ??
          buildMusicPlayerQueue(tracks, prior.mode, trackId, random),
        status: playbackStatusAfterSelection(prior, versionId, trackId),
        error:
          versionId === prior.versionId && trackId === prior.trackId
            ? prior.error
            : null,
        restorePending: false,
      });
    },

    selectVersion: (requestedVersionId) => {
      pendingBootstrapSnapshot = null;
      const versionId = normalizeVersionId(requestedVersionId);
      const prior = get();

      if (
        !hasVersion(prior.tracksByVersion, versionId) ||
        versionId === prior.versionId
      ) {
        return;
      }

      const tracks = prior.tracksByVersion[versionId];
      const trackId = availableTrackId(tracks, prior.trackId);
      set({
        versionId,
        trackId,
        queue: buildMusicPlayerQueue(tracks, prior.mode, trackId, random),
        status: trackId ? "loading" : "idle",
        error: null,
        restorePending: false,
      });
    },

    selectTrack: (trackId) => {
      pendingBootstrapSnapshot = null;
      const prior = get();
      const tracks = prior.versionId
        ? (prior.tracksByVersion[prior.versionId] ?? [])
        : [];

      if (
        trackId === prior.trackId ||
        !tracks.some((track) => track.id === trackId)
      ) {
        return;
      }

      set({
        trackId,
        status: "loading",
        error: null,
        restorePending: false,
      });
    },

    setMode: (mode) => {
      const prior = get();
      if (mode === prior.mode) {
        return;
      }
      const tracks = prior.versionId
        ? (prior.tracksByVersion[prior.versionId] ?? [])
        : [];
      set({
        mode,
        queue: buildMusicPlayerQueue(tracks, mode, prior.trackId, random),
      });
    },

    nextTrackId: () => {
      const { queue, trackId, mode } = get();
      return nextMusicTrackId(queue, trackId, mode);
    },

    previousTrackId: () => {
      const { queue, trackId, mode } = get();
      return previousMusicTrackId(queue, trackId, mode);
    },

    setStatus: (status) => set({ status }),
    setVolume: (volume) =>
      set((state) => ({
        volume: normalizeVolume(volume, state.volume),
      })),
    setMuted: (muted) => set({ muted }),
    setError: (error) => set({ error }),
  }));
}

export const useMusicPlayerStore = createMusicPlayerStore();
