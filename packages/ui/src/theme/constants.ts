// Storage keys and presets shared by ThemeProvider and the no-flash boot
// script, so the two cannot drift apart. No "use client" here: web's root
// layout (a server component) builds the boot script from these values.

/** localStorage key of the light / dark / system preference. */
export const THEME_STORAGE_KEY = "theme";
/** localStorage key of the accent preset. */
export const ACCENT_STORAGE_KEY = "astrodx-accent";

export type ThemePreference = "light" | "dark" | "system";
export const ACCENT_COLORS = ["blue", "violet", "teal", "orange", "rose"] as const;
export type AccentColor = (typeof ACCENT_COLORS)[number];
