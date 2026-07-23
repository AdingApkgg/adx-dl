import { describe, expect, test } from "bun:test";

import {
  MUSIC_PLAYER_STORAGE_KEY,
  parseMusicPlayerSnapshot,
  readMusicPlayerSnapshot,
  writeMusicPlayerSnapshot,
} from "./music-player-persistence";

describe("music player persistence", () => {
  test("normalizes persisted player preferences", () => {
    expect(
      parseMusicPlayerSnapshot({
        versionId: "26",
        trackId: "song-1",
        queue: ["song-1", "song-1", "", 12, "song-2"],
        mode: "shuffle",
        volume: 4,
        muted: true,
        currentTime: -20,
      })
    ).toEqual({
      versionId: "26",
      trackId: "song-1",
      queue: ["song-1", "song-2"],
      mode: "shuffle",
      volume: 1,
      muted: true,
      currentTime: 0,
    });
  });

  test("returns null for unusable values", () => {
    expect(parseMusicPlayerSnapshot(null)).toBeNull();
    expect(parseMusicPlayerSnapshot("bad")).toBeNull();
  });

  test("reads and writes through the supplied storage", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    writeMusicPlayerSnapshot(storage, {
      versionId: "25",
      trackId: "song-9",
      mode: "sequence",
      volume: 0.5,
      muted: false,
      currentTime: 42,
    });

    expect(values.has(MUSIC_PLAYER_STORAGE_KEY)).toBe(true);
    expect(readMusicPlayerSnapshot(storage)).toMatchObject({
      versionId: "25",
      trackId: "song-9",
      currentTime: 42,
    });
  });
});
