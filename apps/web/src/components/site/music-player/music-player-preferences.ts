import { create } from "zustand";

export const MUSIC_PLAYER_PREFS_STORAGE_KEY = "astrodx-music-player-prefs-v1";

export type MusicPlayerSurfaceState = "expanded" | "collapsed" | "off";

export type MusicPlayerPreferences = {
  enabled: boolean;
  collapsed: boolean;
};

// Collapsed by default: the corner bubble stays out of the way until the
// visitor opts into the full bar (their choice is then persisted).
export const DEFAULT_MUSIC_PLAYER_PREFERENCES: MusicPlayerPreferences = {
  enabled: true,
  collapsed: true,
};

export function musicPlayerSurfaceState(
  preferences: MusicPlayerPreferences
): MusicPlayerSurfaceState {
  if (!preferences.enabled) {
    return "off";
  }
  return preferences.collapsed ? "collapsed" : "expanded";
}

export function parseMusicPlayerPreferences(
  value: unknown
): MusicPlayerPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_MUSIC_PLAYER_PREFERENCES };
  }
  const candidate = value as Record<string, unknown>;
  return {
    enabled:
      typeof candidate.enabled === "boolean"
        ? candidate.enabled
        : DEFAULT_MUSIC_PLAYER_PREFERENCES.enabled,
    collapsed:
      typeof candidate.collapsed === "boolean"
        ? candidate.collapsed
        : DEFAULT_MUSIC_PLAYER_PREFERENCES.collapsed,
  };
}

export function readMusicPlayerPreferences(
  storage: Pick<Storage, "getItem">
): MusicPlayerPreferences {
  try {
    const raw = storage.getItem(MUSIC_PLAYER_PREFS_STORAGE_KEY);
    return raw
      ? parseMusicPlayerPreferences(JSON.parse(raw))
      : { ...DEFAULT_MUSIC_PLAYER_PREFERENCES };
  } catch {
    return { ...DEFAULT_MUSIC_PLAYER_PREFERENCES };
  }
}

export function writeMusicPlayerPreferences(
  storage: Pick<Storage, "setItem">,
  preferences: MusicPlayerPreferences
): void {
  try {
    storage.setItem(
      MUSIC_PLAYER_PREFS_STORAGE_KEY,
      JSON.stringify(preferences)
    );
  } catch {
    // Private or locked-down storage must not break the player.
  }
}

/**
 * Mirror the preference onto <html data-music-player> synchronously. The boot
 * script in app/layout.tsx stamps the same attribute before first paint, and
 * globals.css keys the download dock's bottom reserve plus the pre-hydration
 * visibility of the player surfaces off it — updating it inside the store
 * action (not an effect) keeps CSS and React from disagreeing for a frame.
 */
function syncSurfaceStateAttribute(preferences: MusicPlayerPreferences): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.dataset.musicPlayer =
    musicPlayerSurfaceState(preferences);
}

/**
 * Re-stamp the attribute from the current store state. React resets the
 * <html> singleton's attributes when a navigation crosses the (default) ↔
 * [locale] route groups and remounts the document tree, wiping imperatively
 * set data attributes — mounted consumers call this to restore it.
 */
export function syncMusicPlayerSurfaceAttribute(): void {
  const { enabled, collapsed } = useMusicPlayerPreferences.getState();
  syncSurfaceStateAttribute({ enabled, collapsed });
}

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export type MusicPlayerPreferencesStore = MusicPlayerPreferences & {
  hydrated: boolean;
  hydrate: () => void;
  setEnabled: (enabled: boolean) => void;
  setCollapsed: (collapsed: boolean) => void;
};

export const useMusicPlayerPreferences =
  create<MusicPlayerPreferencesStore>()((set, get) => {
    const applyChange = (change: Partial<MusicPlayerPreferences>) => {
      const next: MusicPlayerPreferences = {
        enabled: get().enabled,
        collapsed: get().collapsed,
        ...change,
      };
      set(change);
      syncSurfaceStateAttribute(next);
      const storage = browserStorage();
      if (storage) {
        writeMusicPlayerPreferences(storage, next);
      }
    };

    return {
      ...DEFAULT_MUSIC_PLAYER_PREFERENCES,
      hydrated: false,

      hydrate: () => {
        if (get().hydrated) {
          return;
        }
        const storage = browserStorage();
        const preferences = storage
          ? readMusicPlayerPreferences(storage)
          : { ...DEFAULT_MUSIC_PLAYER_PREFERENCES };
        set({ ...preferences, hydrated: true });
        syncSurfaceStateAttribute(preferences);
      },

      setEnabled: (enabled) => applyChange({ enabled }),
      setCollapsed: (collapsed) => applyChange({ collapsed }),
    };
  });
