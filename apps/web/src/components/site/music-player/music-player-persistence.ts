import type {
  MusicPlayerMode,
  MusicPlayerPersistedSnapshot,
} from "./music-player-store";

export const MUSIC_PLAYER_STORAGE_KEY = "astrodx-music-player-v1";

export type StoredMusicPlayerSnapshot = MusicPlayerPersistedSnapshot & {
  currentTime?: number;
};

function isMode(value: unknown): value is MusicPlayerMode {
  return value === "sequence" || value === "shuffle" || value === "repeat-one";
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function parseMusicPlayerSnapshot(
  value: unknown
): StoredMusicPlayerSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const versionId =
    typeof candidate.versionId === "string" && candidate.versionId.length > 0
      ? candidate.versionId
      : undefined;
  const trackId =
    typeof candidate.trackId === "string" && candidate.trackId.length > 0
      ? candidate.trackId
      : undefined;
  const queue = Array.isArray(candidate.queue)
    ? Array.from(
        new Set(
          candidate.queue.filter(
            (trackId): trackId is string =>
              typeof trackId === "string" && trackId.length > 0
          )
        )
      ).slice(0, 500)
    : undefined;
  const volumeValue = finiteNumber(candidate.volume);
  const currentTimeValue = finiteNumber(candidate.currentTime);

  return {
    ...(versionId ? { versionId } : {}),
    ...(trackId ? { trackId } : {}),
    ...(queue ? { queue } : {}),
    ...(isMode(candidate.mode) ? { mode: candidate.mode } : {}),
    ...(volumeValue !== undefined
      ? { volume: Math.min(1, Math.max(0, volumeValue)) }
      : {}),
    ...(typeof candidate.muted === "boolean"
      ? { muted: candidate.muted }
      : {}),
    ...(currentTimeValue !== undefined
      ? { currentTime: Math.min(86_400, Math.max(0, currentTimeValue)) }
      : {}),
  };
}

export function readMusicPlayerSnapshot(
  storage: Pick<Storage, "getItem">
): StoredMusicPlayerSnapshot | null {
  try {
    const raw = storage.getItem(MUSIC_PLAYER_STORAGE_KEY);
    return raw ? parseMusicPlayerSnapshot(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function writeMusicPlayerSnapshot(
  storage: Pick<Storage, "setItem">,
  snapshot: StoredMusicPlayerSnapshot
): void {
  try {
    storage.setItem(MUSIC_PLAYER_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Private or locked-down storage must not break playback.
  }
}
