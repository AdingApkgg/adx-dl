"use client";

import * as React from "react";

export type ThemePreference = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";
export const ACCENT_COLORS = [
  "blue",
  "violet",
  "teal",
  "orange",
  "rose",
] as const;
export type AccentColor = (typeof ACCENT_COLORS)[number];

type ThemeContextValue = {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  accent: AccentColor;
  setTheme: (theme: ThemePreference) => void;
  setAccent: (accent: AccentColor) => void;
};

const ThemeContext = React.createContext<ThemeContextValue | undefined>(undefined);

const storageKey = "theme";
const accentStorageKey = "astrodx-accent";
const themeChangeEvent = "astrodx-theme-change";
let sessionTheme: ThemePreference | null = null;
let sessionAccent: AccentColor | null = null;

function applyResolvedTheme(theme: ResolvedTheme) {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.classList.toggle("dark", theme === "dark");
  // The boot script pins an inline color-scheme so the pre-CSS canvas paints
  // in the persisted mode. Inline beats the stylesheet's `.dark`/`:root`
  // color-scheme, so runtime switches must keep it in step.
  document.documentElement.style.colorScheme =
    theme === "dark" ? "dark" : "light";
}

function applyAccent(accent: AccentColor) {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.dataset.accent = accent;
}

const fallbackValue: ThemeContextValue = {
  theme: "system",
  resolvedTheme: "dark",
  accent: "blue",
  setTheme: () => {},
  setAccent: () => {},
};

export function useTheme(): ThemeContextValue {
  return React.useContext(ThemeContext) ?? fallbackValue;
}

function subscribeThemePreference(callback: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const storageHandler = () => {
    sessionTheme = null;
    sessionAccent = null;
    callback();
  };
  const handler = () => callback();
  window.addEventListener("storage", storageHandler);
  window.addEventListener(themeChangeEvent, handler as EventListener);

  return () => {
    window.removeEventListener("storage", storageHandler);
    window.removeEventListener(themeChangeEvent, handler as EventListener);
  };
}

function getThemePreferenceSnapshot(): ThemePreference {
  if (typeof window === "undefined") {
    return "system";
  }
  if (sessionTheme !== null) {
    return sessionTheme;
  }
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // Storage can be unavailable in private/locked-down contexts.
  }
  return "system";
}

function getThemePreferenceServerSnapshot(): ThemePreference {
  return "system";
}

export function parseAccentColor(value: string | null | undefined): AccentColor {
  return ACCENT_COLORS.includes(value as AccentColor)
    ? (value as AccentColor)
    : "blue";
}

function getAccentSnapshot(): AccentColor {
  if (typeof window === "undefined") {
    return "blue";
  }
  if (sessionAccent !== null) {
    return sessionAccent;
  }
  try {
    return parseAccentColor(window.localStorage.getItem(accentStorageKey));
  } catch {
    return "blue";
  }
}

function getAccentServerSnapshot(): AccentColor {
  return "blue";
}

function subscribeSystemTheme(callback: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => callback();

  if (mediaQuery.addEventListener) {
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }

  mediaQuery.addListener(handler);
  return () => mediaQuery.removeListener(handler);
}

function getSystemThemeSnapshot(): ResolvedTheme {
  if (typeof window === "undefined") {
    return "dark";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getSystemThemeServerSnapshot(): ResolvedTheme {
  return "dark";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = React.useSyncExternalStore(
    subscribeThemePreference,
    getThemePreferenceSnapshot,
    getThemePreferenceServerSnapshot
  );

  const systemTheme = React.useSyncExternalStore(
    subscribeSystemTheme,
    getSystemThemeSnapshot,
    getSystemThemeServerSnapshot
  );
  const accent = React.useSyncExternalStore(
    subscribeThemePreference,
    getAccentSnapshot,
    getAccentServerSnapshot
  );

  const resolvedTheme: ResolvedTheme = theme === "system" ? systemTheme : theme;

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    applyResolvedTheme(resolvedTheme);
  }, [resolvedTheme, theme]);

  React.useEffect(() => {
    applyAccent(accent);
  }, [accent]);

  const value = React.useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      accent,
      setTheme: (nextTheme) => {
        if (typeof window === "undefined") {
          return;
        }
        sessionTheme = nextTheme;
        try {
          window.localStorage.setItem(storageKey, nextTheme);
        } catch {
          // Keep the in-memory preference for this session.
        }
        window.dispatchEvent(new Event(themeChangeEvent));
      },
      setAccent: (nextAccent) => {
        if (typeof window === "undefined") {
          return;
        }
        sessionAccent = parseAccentColor(nextAccent);
        try {
          window.localStorage.setItem(accentStorageKey, sessionAccent);
        } catch {
          // Keep the in-memory preference for this session.
        }
        window.dispatchEvent(new Event(themeChangeEvent));
      },
    }),
    [accent, resolvedTheme, theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
