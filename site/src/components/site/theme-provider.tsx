"use client";

import * as React from "react";

type ThemePreference = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

type ThemeContextValue = {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
};

const ThemeContext = React.createContext<ThemeContextValue | undefined>(undefined);

const storageKey = "theme";
const themeChangeEvent = "astrodx-theme-change";

function applyResolvedTheme(theme: ResolvedTheme) {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.classList.toggle("dark", theme === "dark");
}

const fallbackValue: ThemeContextValue = {
  theme: "dark",
  resolvedTheme: "dark",
  setTheme: () => {},
};

export function useTheme(): ThemeContextValue {
  return React.useContext(ThemeContext) ?? fallbackValue;
}

function subscribeThemePreference(callback: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handler = () => callback();
  window.addEventListener("storage", handler);
  window.addEventListener(themeChangeEvent, handler as EventListener);

  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener(themeChangeEvent, handler as EventListener);
  };
}

function getThemePreferenceSnapshot(): ThemePreference {
  if (typeof window === "undefined") {
    return "dark";
  }
  const stored = window.localStorage.getItem(storageKey);
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }
  return "dark";
}

function getThemePreferenceServerSnapshot(): ThemePreference {
  return "dark";
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

  const resolvedTheme: ResolvedTheme = theme === "system" ? systemTheme : theme;

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    applyResolvedTheme(resolvedTheme);
  }, [resolvedTheme, theme]);

  const value = React.useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      setTheme: (nextTheme) => {
        if (typeof window === "undefined") {
          return;
        }
        window.localStorage.setItem(storageKey, nextTheme);
        window.dispatchEvent(new Event(themeChangeEvent));
      },
    }),
    [resolvedTheme, theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
