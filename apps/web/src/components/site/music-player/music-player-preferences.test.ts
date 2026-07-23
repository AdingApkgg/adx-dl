import { afterEach, describe, expect, test } from "bun:test";

import {
  DEFAULT_MUSIC_PLAYER_PREFERENCES,
  MUSIC_PLAYER_PREFS_STORAGE_KEY,
  musicPlayerSurfaceState,
  parseMusicPlayerPreferences,
  readMusicPlayerPreferences,
  useMusicPlayerPreferences,
  writeMusicPlayerPreferences,
} from "./music-player-preferences";

afterEach(() => {
  useMusicPlayerPreferences.setState({
    ...DEFAULT_MUSIC_PLAYER_PREFERENCES,
    hydrated: false,
  });
});

describe("music player preferences parsing", () => {
  test("falls back to defaults for unusable values", () => {
    expect(parseMusicPlayerPreferences(null)).toEqual(
      DEFAULT_MUSIC_PLAYER_PREFERENCES
    );
    expect(parseMusicPlayerPreferences("bad")).toEqual(
      DEFAULT_MUSIC_PLAYER_PREFERENCES
    );
    expect(parseMusicPlayerPreferences([true])).toEqual(
      DEFAULT_MUSIC_PLAYER_PREFERENCES
    );
    expect(parseMusicPlayerPreferences({ enabled: "no", collapsed: 1 })).toEqual(
      DEFAULT_MUSIC_PLAYER_PREFERENCES
    );
  });

  test("keeps explicit booleans", () => {
    expect(
      parseMusicPlayerPreferences({ enabled: false, collapsed: false })
    ).toEqual({ enabled: false, collapsed: false });
  });

  test("maps preferences to the surface state attribute value", () => {
    expect(
      musicPlayerSurfaceState({ enabled: true, collapsed: false })
    ).toBe("expanded");
    expect(
      musicPlayerSurfaceState({ enabled: true, collapsed: true })
    ).toBe("collapsed");
    // Disabled always wins over collapsed.
    expect(
      musicPlayerSurfaceState({ enabled: false, collapsed: true })
    ).toBe("off");
  });

  test("reads and writes through the supplied storage", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(readMusicPlayerPreferences(storage)).toEqual(
      DEFAULT_MUSIC_PLAYER_PREFERENCES
    );

    writeMusicPlayerPreferences(storage, { enabled: false, collapsed: false });
    expect(values.has(MUSIC_PLAYER_PREFS_STORAGE_KEY)).toBe(true);
    expect(readMusicPlayerPreferences(storage)).toEqual({
      enabled: false,
      collapsed: false,
    });
  });

  test("survives corrupted persisted JSON", () => {
    const storage = {
      getItem: () => "{not json",
    };
    expect(readMusicPlayerPreferences(storage)).toEqual(
      DEFAULT_MUSIC_PLAYER_PREFERENCES
    );
  });
});

describe("music player preferences store", () => {
  test("defaults to an enabled, collapsed player", () => {
    const state = useMusicPlayerPreferences.getState();
    expect(state.enabled).toBe(true);
    expect(state.collapsed).toBe(true);
    expect(state.hydrated).toBe(false);
  });

  test("toggles enabled and collapsed independently", () => {
    useMusicPlayerPreferences.getState().setCollapsed(false);
    expect(useMusicPlayerPreferences.getState()).toMatchObject({
      enabled: true,
      collapsed: false,
    });

    useMusicPlayerPreferences.getState().setEnabled(false);
    expect(useMusicPlayerPreferences.getState()).toMatchObject({
      enabled: false,
      collapsed: false,
    });

    useMusicPlayerPreferences.getState().setEnabled(true);
    expect(useMusicPlayerPreferences.getState()).toMatchObject({
      enabled: true,
      collapsed: false,
    });
  });

  test("hydrate is idempotent", () => {
    useMusicPlayerPreferences.getState().hydrate();
    expect(useMusicPlayerPreferences.getState().hydrated).toBe(true);

    // A second hydrate must not clobber changes made after the first one.
    useMusicPlayerPreferences.getState().setCollapsed(false);
    useMusicPlayerPreferences.getState().hydrate();
    expect(useMusicPlayerPreferences.getState().collapsed).toBe(false);
  });
});
